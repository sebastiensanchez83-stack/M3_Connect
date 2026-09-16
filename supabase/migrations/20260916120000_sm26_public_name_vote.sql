-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- SM26 public vote without an account: type your name, vote.
--
-- The audience vote is announced with a static QR in the event presentation
-- (smartmarinaconnect.com/sm26/vote) and a Vote tile on /sm26. Until now voting
-- needed an account and a check-in, and the check-in test (sm_is_checked_in)
-- only recognised whoever *created* a registration: 41 of 94 attending people
-- could never have voted, while an absent registrant could, once a colleague
-- was scanned.
--
-- The organiser's rule (16 Sep 2026): anyone on the final attendee list votes
-- by typing first and last name. No account, no Wi-Fi, no check-in. One vote
-- per name per prize, and one person per phone (a phone and a name bind to each
-- other on the first vote, across prizes); a vote can be changed from that
-- phone until staff close voting. Staff can add a missing name at the desk.
-- Results stay with staff until the award ceremony.
--
-- WHO MAY VOTE AND WHAT IS ON THE BALLOT ARE FROZEN, STAFF-OWNED LISTS.
-- A first version read both live, and review showed why that fails: any
-- registrant can add rows to their own attendee roster until 22 Sep, and any
-- new account can file a 'submitted' registration with a startup role — so a
-- founder could invent twenty "colleagues" and vote twenty times, or put a
-- look-alike of a rival (or any text) on the ballot the whole room opens.
-- sm_vote_voter and sm_vote_entry are copies taken by staff
-- (sm_admin_vote_sync, preview then apply) from confirmed registrations; the
-- public side reads only those. Names are copied, so a roster edit afterwards
-- cannot rename a voter.
--
-- Matching is sm_vote_match — token sets, accent- and case-blind, order-free,
-- tolerant of a middle name or particle left out, but only ever accepting a
-- UNIQUE match (simulated on the live pool: 94/94 attendees resolve to
-- themselves, 0 cross). The public side answers only ok / not_found / ambiguous
-- and never names anyone, and the name is checked only after the choices are
-- known to be valid, so every successful lookup casts a real vote.
--
-- Known and accepted: someone who knows an attendee's name can vote as them.
-- The real person then sees "this name has already voted" and goes to the
-- desk; staff cancel that name's votes (both prizes) and can block the phone.
--
-- Applied through the MCP apply_migration, which already wraps this file in a
-- transaction.

-- 1. The frozen lists ---------------------------------------------------------

create table if not exists public.sm_vote_voter (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.sm_event(id),
  source      text not null check (source in ('list', 'desk')),
  attendee_id uuid references public.sm_attendee(id) on delete set null,
  first_name  text not null,
  last_name   text not null,
  note        text,
  added_by    uuid,
  created_at  timestamptz not null default now(),
  removed_at  timestamptz
);
comment on table public.sm_vote_voter is
  'SM26 audience vote: who may vote. Staff-owned copy (list = synced from confirmed attendees; desk = added by staff). Names are copied, never read live.';
create unique index if not exists sm_vote_voter_attendee_uq on public.sm_vote_voter (event_id, attendee_id) where attendee_id is not null;

create table if not exists public.sm_vote_entry (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.sm_event(id),
  competition        text not null,
  role_assignment_id uuid not null references public.sm_role_assignment(id) on delete cascade,
  title              text not null,
  subtitle           text,
  created_at         timestamptz not null default now(),
  removed_at         timestamptz,
  constraint sm_vote_entry_uq unique (event_id, competition, role_assignment_id)
);
comment on table public.sm_vote_entry is
  'SM26 audience vote: what is on the ballot. Staff-owned copy taken by sm_admin_vote_sync; titles are copied so a company rename cannot change the ballot.';

create table if not exists public.sm_vote_attempt (
  id          bigserial primary key,
  event_id    uuid not null,
  device_hash text not null,
  ip_hash     text,
  ok          boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists sm_vote_attempt_device_idx on public.sm_vote_attempt (device_hash, created_at);
create index if not exists sm_vote_attempt_ip_idx on public.sm_vote_attempt (ip_hash, created_at);

create table if not exists public.sm_vote_blocked_device (
  event_id    uuid not null,
  device_hash text not null,
  blocked_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (event_id, device_hash)
);

do $$
declare t text;
begin
  foreach t in array array['sm_vote_voter', 'sm_vote_entry', 'sm_vote_attempt', 'sm_vote_blocked_device'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 2. Votes keyed on a listed person and a phone, not an account ---------------
-- (0 rows when this was written, so the reshape moves no data.)

alter table public.sm_public_vote alter column voter_user_id drop not null;
alter table public.sm_public_vote drop constraint if exists sm_public_vote_voter_user_id_competition_key;
alter table public.sm_public_vote add column if not exists voter_key text;
alter table public.sm_public_vote add column if not exists voter_id uuid references public.sm_vote_voter(id) on delete set null;
alter table public.sm_public_vote add column if not exists voter_name text;
alter table public.sm_public_vote add column if not exists device_hash text;
alter table public.sm_public_vote add column if not exists ip_hash text;
alter table public.sm_public_vote add column if not exists cast_by uuid;
alter table public.sm_public_vote add column if not exists updated_at timestamptz;
do $$ begin
  if not exists (select 1 from public.sm_public_vote where voter_key is null) then
    alter table public.sm_public_vote alter column voter_key set not null;
  end if;
end $$;
comment on column public.sm_public_vote.voter_key is
  'voter:<sm_vote_voter.id>. Text, so one-vote-per-person survives the voter row going away.';
comment on column public.sm_public_vote.device_hash is
  'sha256 of the phone''s random key; NULL when staff recorded the vote at the desk (sm_admin_vote_cast_for).';
create unique index if not exists sm_public_vote_voter_uq on public.sm_public_vote (event_id, competition, voter_key);
create unique index if not exists sm_public_vote_device_uq on public.sm_public_vote (event_id, competition, device_hash) where device_hash is not null;

-- 3. Name matching ------------------------------------------------------------

create or replace function public.sm_vote_tokens(p text)
returns text[]
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(array_agg(distinct t order by t) filter (where t <> '' and t !~ '^(mr|mrs|ms|miss|mme|mlle|m|dr|prof|sir|me)$'), '{}'::text[])
  from regexp_split_to_table(public.sm_norm_name(p), ' ') t;
$function$;

create or replace function public.sm_vote_match(p_event_id uuid, p_first text, p_last text)
returns table(status text, voter_key text, voter_id uuid, display_name text, source text)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tt text[] := sm_vote_tokens(coalesce(p_first, '') || ' ' || coalesce(p_last, ''));
  v_sq1 text := replace(sm_norm_name(coalesce(p_first, '') || ' ' || coalesce(p_last, '')), ' ', '');
  v_sq2 text := replace(sm_norm_name(coalesce(p_last, '') || ' ' || coalesce(p_first, '')), ' ', '');
begin
  if cardinality(v_tt) < 2 then
    return query select 'not_found'::text, null::text, null::uuid, null::text, null::text;
    return;
  end if;

  return query
  with pool as (
    select vv.id as vid, vv.source as src,
           nullif(trim(vv.first_name || ' ' || vv.last_name), '') as disp,
           sm_vote_tokens(vv.first_name) as ft, sm_vote_tokens(vv.last_name) as lt,
           sm_vote_tokens(vv.first_name || ' ' || vv.last_name) as tokens,
           replace(sm_norm_name(vv.first_name || ' ' || vv.last_name), ' ', '') as sq
      from sm_vote_voter vv
     where vv.event_id = p_event_id and vv.removed_at is null
  ),
  sig as (
    -- Surname tokens that identify: particles only count when the surname is nothing but particles.
    select p.*,
           coalesce(nullif(array(select t from unnest(p.lt) t
                                  where t !~ '^(de|du|da|di|des|del|della|van|von|der|den|ter|le|la|el|al|ben|bin|dos|das|st|saint)$'),
                           '{}'::text[]), p.lt) as lt_sig
      from pool p
  ),
  tier1 as (   -- the same name: same token set in any order, or the same letters ignoring spaces/hyphens
    select s.vid, s.src, s.disp from sig s
     where (s.tokens @> v_tt and v_tt @> s.tokens) or s.sq in (v_sq1, v_sq2)
  ),
  tier1_pick as (   -- a desk-added duplicate of a listed person never locks the listed person out
    select * from tier1
     where (select count(*) from tier1) = 1
        or (src = 'list' and (select count(*) from tier1 where src = 'list') = 1)
  ),
  tier2 as (   -- part of the name: what was typed is a subset, with a first-name and a real surname token
    select s.vid, s.src, s.disp from sig s
     where v_tt <@ s.tokens and v_tt && s.ft and v_tt && s.lt_sig
  ),
  decided as (
    select case
             when (select count(*) from tier1_pick) = 1 then 'tier1'
             when (select count(*) from tier1) > 0 then 'ambiguous'
             when (select count(*) from tier2) = 1 then 'tier2'
             when (select count(*) from tier2) > 1 then 'ambiguous'
             else 'not_found'
           end as how
  )
  select case d.how when 'tier1' then 'ok' when 'tier2' then 'ok' else d.how end,
         case when c.vid is not null then 'voter:' || c.vid::text end, c.vid, c.disp, c.src
    from decided d
    left join lateral (
      select t.vid, t.src, t.disp from tier1_pick t where d.how = 'tier1'
      union all
      select t.vid, t.src, t.disp from tier2 t where d.how = 'tier2'
    ) c on true;
end $function$;

-- The caller's network, hashed. PostgREST exposes request headers; nothing else does.
create or replace function public.sm_vote_ip_hash(p_event_id uuid)
returns text
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare v_headers json; v_ip text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := nullif(trim(split_part(coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-forwarded-for', ''), ',', 1)), '');
  if v_ip is null then return null; end if;
  return encode(extensions.digest(v_ip || ':' || p_event_id::text, 'sha256'), 'hex');
end $function$;

-- 4. Syncing the frozen lists (staff) -----------------------------------------
-- Preview with p_apply = false. Applying adds what is new and retires what is
-- gone, but never retires a voter or an entry that already has votes: those are
-- reported for staff to decide (cancel votes first).

create or replace function public.sm_admin_vote_sync(p_apply boolean default false)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event uuid;
  v_voters_new jsonb; v_voters_gone jsonb; v_entries_new jsonb; v_entries_gone jsonb;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  select e.id into v_event from sm_event e where e.slug = 'sm26';

  -- Who should be on the list: attending people on CONFIRMED registrations.
  create temp table if not exists _vote_should_voters (attendee_id uuid, first_name text, last_name text) on commit drop;
  truncate _vote_should_voters;
  insert into _vote_should_voters
  select a.id, coalesce(nullif(trim(a.first_name), ''), ''), coalesce(nullif(trim(a.last_name), ''), '')
    from sm_attendee a join sm_registration r on r.id = a.registration_id
   where a.event_id = v_event and a.attending and r.status = 'confirmed';

  -- What should be on the ballot: the vote's roles, not declined, registration live.
  create temp table if not exists _vote_should_entries (competition text, role_assignment_id uuid, title text, subtitle text) on commit drop;
  truncate _vote_should_entries;
  insert into _vote_should_entries
  select c.competition, ra.id,
         coalesce(nullif(trim(r.company_name), ''), nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), 'Entry'),
         coalesce(sp.stage, ae.category, '')
    from (select distinct a.competition from sm_award a where a.event_id = v_event and a.type = 'public' and not a.hidden) c
    join sm_role_assignment ra on ra.event_id = v_event and ra.role = any(sm_vote_roles(c.competition)) and ra.status <> 'declined'
    join sm_registration r on r.id = ra.registration_id and r.status not in ('declined', 'cancelled')
    left join sm_startup_profile sp on sp.role_assignment_id = ra.id
    left join sm_architecture_entry ae on ae.role_assignment_id = ra.id;

  select coalesce(jsonb_agg(jsonb_build_object('attendee_id', s.attendee_id, 'name', trim(s.first_name || ' ' || s.last_name)) order by s.last_name, s.first_name), '[]'::jsonb)
    into v_voters_new
    from _vote_should_voters s
   where not exists (select 1 from sm_vote_voter vv where vv.event_id = v_event and vv.attendee_id = s.attendee_id and vv.removed_at is null);

  select coalesce(jsonb_agg(jsonb_build_object('voter_id', vv.id, 'name', trim(vv.first_name || ' ' || vv.last_name),
                                               'has_votes', exists (select 1 from sm_public_vote pv where pv.voter_key = 'voter:' || vv.id::text))
                            order by vv.last_name, vv.first_name), '[]'::jsonb)
    into v_voters_gone
    from sm_vote_voter vv
   where vv.event_id = v_event and vv.source = 'list' and vv.removed_at is null
     and not exists (select 1 from _vote_should_voters s where s.attendee_id = vv.attendee_id);

  select coalesce(jsonb_agg(jsonb_build_object('competition', s.competition, 'title', s.title) order by s.competition, lower(s.title)), '[]'::jsonb)
    into v_entries_new
    from _vote_should_entries s
   where not exists (select 1 from sm_vote_entry ve where ve.event_id = v_event and ve.competition = s.competition
                        and ve.role_assignment_id = s.role_assignment_id and ve.removed_at is null);

  select coalesce(jsonb_agg(jsonb_build_object('entry_id', ve.id, 'competition', ve.competition, 'title', ve.title,
                                               'has_votes', exists (select 1 from sm_public_vote pv where pv.entry_role_assignment_id = ve.role_assignment_id and pv.competition = ve.competition))
                            order by ve.competition, lower(ve.title)), '[]'::jsonb)
    into v_entries_gone
    from sm_vote_entry ve
   where ve.event_id = v_event and ve.removed_at is null
     and not exists (select 1 from _vote_should_entries s where s.competition = ve.competition and s.role_assignment_id = ve.role_assignment_id);

  if p_apply then
    insert into sm_vote_voter (event_id, source, attendee_id, first_name, last_name, added_by)
    select v_event, 'list', s.attendee_id, s.first_name, s.last_name, auth.uid()
      from _vote_should_voters s
     where not exists (select 1 from sm_vote_voter vv where vv.event_id = v_event and vv.attendee_id = s.attendee_id and vv.removed_at is null)
    on conflict (event_id, attendee_id) where attendee_id is not null
      do update set removed_at = null, first_name = excluded.first_name, last_name = excluded.last_name;

    update sm_vote_voter vv set removed_at = now()
     where vv.event_id = v_event and vv.source = 'list' and vv.removed_at is null
       and not exists (select 1 from _vote_should_voters s where s.attendee_id = vv.attendee_id)
       and not exists (select 1 from sm_public_vote pv where pv.voter_key = 'voter:' || vv.id::text);

    insert into sm_vote_entry (event_id, competition, role_assignment_id, title, subtitle)
    select v_event, s.competition, s.role_assignment_id, s.title, s.subtitle from _vote_should_entries s
    on conflict (event_id, competition, role_assignment_id)
      do update set removed_at = null
      where sm_vote_entry.removed_at is not null;

    update sm_vote_entry ve set removed_at = now()
     where ve.event_id = v_event and ve.removed_at is null
       and not exists (select 1 from _vote_should_entries s where s.competition = ve.competition and s.role_assignment_id = ve.role_assignment_id)
       and not exists (select 1 from sm_public_vote pv where pv.entry_role_assignment_id = ve.role_assignment_id and pv.competition = ve.competition);
  end if;

  return jsonb_build_object(
    'applied', p_apply,
    'voters', (select count(*) from sm_vote_voter vv where vv.event_id = v_event and vv.removed_at is null),
    'entries', (select jsonb_object_agg(x.competition, x.n) from (select ve.competition, count(*) n from sm_vote_entry ve where ve.event_id = v_event and ve.removed_at is null group by ve.competition) x),
    'voters_new', v_voters_new, 'voters_gone', v_voters_gone,
    'entries_new', v_entries_new, 'entries_gone', v_entries_gone);
end $function$;

-- 5. The public side ----------------------------------------------------------

create or replace function public.sm_vote_is_live(p_event_id uuid, p_competition text)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from sm_vote_config v
                  where v.event_id = p_event_id and v.competition = p_competition and v.is_open)
     and exists (select 1 from sm_award a
                  where a.event_id = p_event_id and a.competition = p_competition and a.type = 'public' and not a.hidden);
$function$;

-- For the /sm26 tile and the vote page's waiting states. Says nothing about results.
create or replace function public.sm_public_vote_status()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_event uuid;
begin
  select e.id into v_event from sm_event e where e.slug = 'sm26';
  if v_event is null then return jsonb_build_object('open', '[]'::jsonb, 'had_votes', false); end if;
  return jsonb_build_object(
    'open', coalesce((select jsonb_agg(v.competition order by v.competition) from sm_vote_config v
                       where v.event_id = v_event and sm_vote_is_live(v_event, v.competition)), '[]'::jsonb),
    'had_votes', exists (select 1 from sm_public_vote pv where pv.event_id = v_event));
end $function$;

-- The ballot for this phone: open prizes, their frozen entries, and what this phone chose.
create or replace function public.sm_public_ballot(p_device text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_event uuid; v_dev text;
begin
  select e.id into v_event from sm_event e where e.slug = 'sm26';
  if v_event is null then return jsonb_build_object('competitions', '[]'::jsonb, 'had_votes', false); end if;
  v_dev := case when coalesce(p_device, '') ~ '^[0-9a-f]{32,64}$' then encode(extensions.digest(p_device, 'sha256'), 'hex') end;
  return jsonb_build_object(
    'competitions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', v.competition,
               'label', (select a.label from sm_award a where a.event_id = v_event and a.competition = v.competition and a.type = 'public' order by a.sort limit 1),
               'my_vote', (select pv.entry_role_assignment_id from sm_public_vote pv
                            where v_dev is not null and pv.event_id = v_event and pv.competition = v.competition and pv.device_hash = v_dev),
               'entries', (select coalesce(jsonb_agg(jsonb_build_object('id', ve.role_assignment_id, 'title', ve.title, 'subtitle', coalesce(ve.subtitle, '')) order by lower(ve.title)), '[]'::jsonb)
                             from sm_vote_entry ve
                            where ve.event_id = v_event and ve.competition = v.competition and ve.removed_at is null)
             ) order by v.competition)
        from sm_vote_config v
       where v.event_id = v_event and sm_vote_is_live(v_event, v.competition)), '[]'::jsonb),
    'my_votes', (select count(*) from sm_public_vote pv where v_dev is not null and pv.event_id = v_event and pv.device_hash = v_dev),
    'had_votes', exists (select 1 from sm_public_vote pv where pv.event_id = v_event));
end $function$;

-- Cast (or change) this phone's votes. p_choices = {"innovation": "<entry id>", ...}.
create or replace function public.sm_public_cast_votes(p_device text, p_first text, p_last text, p_choices jsonb)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event uuid; v_dev text; v_ip text; v_m record;
  v_comp text; v_raw text; v_row sm_public_vote;
  v_valid jsonb := '{}'::jsonb; v_results jsonb := '{}'::jsonb; v_any_ok boolean := false; v_n int;
begin
  select e.id into v_event from sm_event e where e.slug = 'sm26';
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'no_event'); end if;
  if coalesce(p_device, '') !~ '^[0-9a-f]{32,64}$' then return jsonb_build_object('ok', false, 'error', 'bad_device'); end if;
  if p_choices is null or jsonb_typeof(p_choices) <> 'object' or p_choices = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'no_choice');
  end if;

  -- The choices first: a name is only ever checked on the way to casting a real vote.
  for v_comp, v_raw in select k.key, k.value #>> '{}' from jsonb_each(p_choices) k loop
    if not sm_vote_is_live(v_event, v_comp) then
      v_results := v_results || jsonb_build_object(v_comp, 'closed');
    elsif v_raw is null or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_results := v_results || jsonb_build_object(v_comp, 'invalid_entry');
    elsif not exists (select 1 from sm_vote_entry ve where ve.event_id = v_event and ve.competition = v_comp
                         and ve.role_assignment_id = v_raw::uuid and ve.removed_at is null) then
      v_results := v_results || jsonb_build_object(v_comp, 'invalid_entry');
    else
      v_valid := v_valid || jsonb_build_object(v_comp, v_raw);
    end if;
  end loop;
  if v_valid = '{}'::jsonb then
    return jsonb_build_object('ok', false,
      'error', case when not exists (select 1 from jsonb_each_text(v_results) x where x.value <> 'closed') then 'closed' else 'invalid_choice' end,
      'results', v_results);
  end if;

  v_dev := encode(extensions.digest(p_device, 'sha256'), 'hex');
  v_ip := sm_vote_ip_hash(v_event);
  if exists (select 1 from sm_vote_blocked_device b where b.event_id = v_event and b.device_hash = v_dev) then
    return jsonb_build_object('ok', false, 'error', 'device_blocked');
  end if;

  -- Guessing names costs: 8 misses per phone, or 300 per network, per 10 minutes
  -- (the venue Wi-Fi is one network for everyone; staff can reset the counters).
  if (select count(*) from sm_vote_attempt a where a.event_id = v_event and a.device_hash = v_dev and not a.ok and a.created_at > now() - interval '10 minutes') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if v_ip is not null and (select count(*) from sm_vote_attempt a where a.event_id = v_event and a.ip_hash = v_ip and not a.ok and a.created_at > now() - interval '10 minutes') >= 300 then
    return jsonb_build_object('ok', false, 'error', 'network_limited');
  end if;

  select * into v_m from sm_vote_match(v_event, left(p_first, 120), left(p_last, 120)) limit 1;
  if v_m.status is distinct from 'ok' then
    insert into sm_vote_attempt (event_id, device_hash, ip_hash, ok) values (v_event, v_dev, v_ip, false);
    return jsonb_build_object('ok', false, 'error', coalesce(v_m.status, 'not_found'));
  end if;

  -- One person per phone, across every prize: the first name to vote on a phone
  -- owns it, and a name belongs to the phone (or desk) it first voted from.
  if exists (select 1 from sm_public_vote pv where pv.event_id = v_event and pv.voter_key = v_m.voter_key and pv.device_hash is distinct from v_dev) then
    insert into sm_vote_attempt (event_id, device_hash, ip_hash, ok) values (v_event, v_dev, v_ip, true);
    return jsonb_build_object('ok', false, 'error', 'name_already_voted');
  end if;
  if exists (select 1 from sm_public_vote pv where pv.event_id = v_event and pv.device_hash = v_dev and pv.voter_key <> v_m.voter_key) then
    insert into sm_vote_attempt (event_id, device_hash, ip_hash, ok) values (v_event, v_dev, v_ip, true);
    return jsonb_build_object('ok', false, 'error', 'device_already_voted');
  end if;

  for v_comp, v_raw in select k.key, k.value #>> '{}' from jsonb_each(v_valid) k loop
    select * into v_row from sm_public_vote pv
     where pv.event_id = v_event and pv.competition = v_comp and pv.voter_key = v_m.voter_key;
    if v_row.id is not null then
      update sm_public_vote pv
         set entry_role_assignment_id = v_raw::uuid, updated_at = now(), ip_hash = coalesce(v_ip, pv.ip_hash)
       where pv.id = v_row.id;
      v_results := v_results || jsonb_build_object(v_comp, case when v_row.entry_role_assignment_id = v_raw::uuid then 'unchanged' else 'changed' end);
      v_any_ok := true;
    else
      insert into sm_public_vote (event_id, competition, entry_role_assignment_id, voter_key, voter_id, voter_name,
                                  device_hash, ip_hash, created_at, updated_at)
      values (v_event, v_comp, v_raw::uuid, v_m.voter_key, v_m.voter_id, v_m.display_name, v_dev, v_ip, now(), now())
      on conflict do nothing;
      get diagnostics v_n = row_count;
      if v_n = 1 then
        v_results := v_results || jsonb_build_object(v_comp, 'voted'); v_any_ok := true;
      else
        v_results := v_results || jsonb_build_object(v_comp, 'retry');
      end if;
    end if;
  end loop;

  insert into sm_vote_attempt (event_id, device_hash, ip_hash, ok) values (v_event, v_dev, v_ip, true);
  return jsonb_build_object('ok', v_any_ok, 'results', v_results);
end $function$;

-- The account-based cast is retired: one way to vote, one rule.
create or replace function public.sm_cast_vote(p_event_id uuid, p_competition text, p_entry_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  raise exception 'Voting now happens at smartmarinaconnect.com/sm26/vote — type your name there.';
end $function$;

-- The old ballot read entries live from any registration (unconfirmed ones too)
-- and was callable by anyone; the public ballot is sm_public_ballot now.
create or replace function public.sm_vote_ballot(p_event_id uuid, p_competition text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  raise exception 'Voting now happens at smartmarinaconnect.com/sm26/vote — type your name there.';
end $function$;

-- 6. Results stay with staff --------------------------------------------------

create or replace function public.sm_vote_tally(p_event_id uuid, p_competition text)
returns table(entry_id uuid, title text, subtitle text, votes integer)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  select x.rid, x.t, x.st,
         (select count(*) from sm_public_vote v where v.entry_role_assignment_id = x.rid and v.competition = p_competition)::int
    from (
      select ve.role_assignment_id as rid, ve.title as t, coalesce(ve.subtitle, '') as st
        from sm_vote_entry ve
       where ve.event_id = p_event_id and ve.competition = p_competition and ve.removed_at is null
      union
      -- anything that holds votes but has since left the ballot still shows its votes
      select distinct v.entry_role_assignment_id,
             coalesce(nullif(trim(r.company_name), ''), nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), 'Entry'),
             ''
        from sm_public_vote v
        join sm_role_assignment ra on ra.id = v.entry_role_assignment_id
        join sm_registration r on r.id = ra.registration_id
       where v.event_id = p_event_id and v.competition = p_competition
         and not exists (select 1 from sm_vote_entry ve where ve.event_id = p_event_id and ve.competition = p_competition
                            and ve.role_assignment_id = v.entry_role_assignment_id and ve.removed_at is null)
    ) x
   order by 4 desc, 2;
end $function$;

-- Parked awards never reach the public showcase.
create or replace function public.sm_award_results(p_event_id uuid)
returns table(award_key text, award_label text, competition text, type text, winner_title text, winner_subtitle text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select a.key, a.label, a.competition, a.type,
    coalesce(nullif(trim(r.company_name), ''), nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), 'Winner'),
    coalesce(sp.stage, ae.category, '')
  from sm_award a
  join sm_role_assignment ra on ra.id = a.winner_role_assignment_id
  join sm_registration r on r.id = ra.registration_id
  left join sm_startup_profile sp on sp.role_assignment_id = ra.id
  left join sm_architecture_entry ae on ae.role_assignment_id = ra.id
  where a.event_id = p_event_id and a.confirmed = true and not a.hidden
  order by a.sort;
$function$;

-- A winner picked before the ceremony is not readable by attendees.
drop policy if exists sm_award_read on public.sm_award;
create policy sm_award_read on public.sm_award for select to authenticated using (public.sm_is_staff() or confirmed);

-- 7. Staff tools --------------------------------------------------------------

drop function if exists public.sm_admin_vote_voters(uuid, text, uuid);
create or replace function public.sm_admin_vote_voters(p_event_id uuid, p_competition text, p_entry_id uuid default null)
returns table(vote_id uuid, voter_user_id uuid, voter_name text, email text, company text, persona text,
              entry_id uuid, entry_title text, voted_at timestamptz,
              how text, device_tag text, ip_tag text, network_votes integer)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  select v.id,
    v.voter_user_id,
    coalesce(nullif(trim(coalesce(vv.first_name, '') || ' ' || coalesce(vv.last_name, '')), ''), v.voter_name, 'Voter'),
    att.email,
    coalesce(nullif(trim(ar.company_name), ''), nullif(trim(vv.note), '')),
    case when v.device_hash is null and v.cast_by is not null then 'recorded at the desk'
         when vv.source = 'desk' then 'added at the desk'
         when vv.source = 'list' then 'on the attendee list'
         else 'voter no longer listed' end,
    v.entry_role_assignment_id,
    coalesce((select ve.title from sm_vote_entry ve where ve.event_id = v.event_id and ve.competition = v.competition and ve.role_assignment_id = v.entry_role_assignment_id limit 1),
             nullif(trim(r.company_name), ''), 'Entry'),
    coalesce(v.updated_at, v.created_at),
    coalesce(vv.source, 'gone'),
    left(v.device_hash, 6),
    left(v.ip_hash, 6),
    (select count(*) from sm_public_vote v2 where v2.event_id = v.event_id and v2.competition = v.competition and v2.ip_hash = v.ip_hash)::int
  from sm_public_vote v
  join sm_role_assignment ra on ra.id = v.entry_role_assignment_id
  join sm_registration r on r.id = ra.registration_id
  left join sm_vote_voter vv on vv.id = v.voter_id
  left join sm_attendee att on att.id = vv.attendee_id
  left join sm_registration ar on ar.id = att.registration_id
  where v.event_id = p_event_id and v.competition = p_competition
    and (p_entry_id is null or v.entry_role_assignment_id = p_entry_id)
  order by coalesce(v.updated_at, v.created_at) desc;
end $function$;

-- Cancel EVERY vote of the person behind this vote (both prizes), so the name is
-- free again; optionally block the phone(s) that cast them.
drop function if exists public.sm_admin_vote_void(uuid);
create or replace function public.sm_admin_vote_void(p_vote_id uuid, p_block_device boolean default false)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_event uuid; v_key text; n int; b int := 0;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  select pv.event_id, pv.voter_key into v_event, v_key from sm_public_vote pv where pv.id = p_vote_id;
  if v_key is null then return jsonb_build_object('cancelled', 0, 'blocked', 0); end if;
  if p_block_device then
    insert into sm_vote_blocked_device (event_id, device_hash, blocked_by)
    select distinct pv.event_id, pv.device_hash, auth.uid() from sm_public_vote pv
     where pv.event_id = v_event and pv.voter_key = v_key and pv.device_hash is not null
    on conflict do nothing;
    get diagnostics b = row_count;
  end if;
  delete from sm_public_vote pv where pv.event_id = v_event and pv.voter_key = v_key;
  get diagnostics n = row_count;
  return jsonb_build_object('cancelled', n, 'blocked', b);
end $function$;

-- The desk's "is this person on the list?" — the answer the public page never gives.
create or replace function public.sm_admin_vote_check_name(p_first text, p_last text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_event uuid; v_m record;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  select e.id into v_event from sm_event e where e.slug = 'sm26';
  select * into v_m from sm_vote_match(v_event, p_first, p_last) limit 1;
  return jsonb_build_object(
    'status', v_m.status,
    'name', v_m.display_name,
    'source', case v_m.source when 'desk' then 'added at the desk' when 'list' then 'attendee list' end,
    'voted', coalesce((select jsonb_agg(jsonb_build_object('competition', pv.competition, 'vote_id', pv.id, 'at', coalesce(pv.updated_at, pv.created_at), 'at_desk', pv.device_hash is null))
                         from sm_public_vote pv where v_m.voter_key is not null and pv.event_id = v_event and pv.voter_key = v_m.voter_key), '[]'::jsonb));
end $function$;

create or replace function public.sm_admin_vote_add_voter(p_first text, p_last text, p_note text default null)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_event uuid; v_m record; v_id uuid; v_after record;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  select e.id into v_event from sm_event e where e.slug = 'sm26';
  if cardinality(sm_vote_tokens(coalesce(p_first, '') || ' ' || coalesce(p_last, ''))) < 2
     or nullif(trim(p_first), '') is null or nullif(trim(p_last), '') is null then
    return jsonb_build_object('ok', false, 'error', 'need_first_and_last_name');
  end if;
  select * into v_m from sm_vote_match(v_event, p_first, p_last) limit 1;
  if v_m.status = 'ok' then
    return jsonb_build_object('ok', false, 'error', 'already_on_list', 'name', v_m.display_name);
  end if;
  if v_m.status = 'ambiguous' then
    -- Adding the same name again would not help: the voter still could not be told apart.
    return jsonb_build_object('ok', false, 'error', 'shared_name');
  end if;
  insert into sm_vote_voter (event_id, source, first_name, last_name, note, added_by)
  values (v_event, 'desk', trim(p_first), trim(p_last), nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  select * into v_after from sm_vote_match(v_event, p_first, p_last) limit 1;
  if v_after.status is distinct from 'ok' or v_after.voter_id is distinct from v_id then
    raise exception 'That name would still not be recognised on its own — add a middle name or initial and tell the person to type it.';
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

create or replace function public.sm_admin_vote_desk_list()
returns table(id uuid, first_name text, last_name text, note text, created_at timestamptz, voted boolean)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  select vv.id, vv.first_name, vv.last_name, vv.note, vv.created_at,
         exists (select 1 from sm_public_vote pv where pv.voter_key = 'voter:' || vv.id::text)
    from sm_vote_voter vv
    join sm_event e on e.id = vv.event_id and e.slug = 'sm26'
   where vv.source = 'desk' and vv.removed_at is null
   order by vv.created_at desc;
end $function$;

create or replace function public.sm_admin_vote_remove_voter(p_id uuid)
returns integer
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n int;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  update sm_vote_voter vv set removed_at = now() where vv.id = p_id and vv.source = 'desk' and vv.removed_at is null;
  get diagnostics n = row_count;
  return n;
end $function$;

-- For people without a working phone: staff record the vote at the desk.
create or replace function public.sm_admin_vote_cast_for(p_first text, p_last text, p_choices jsonb)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_event uuid; v_m record; v_comp text; v_raw text; v_results jsonb := '{}'::jsonb; v_row sm_public_vote;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  select e.id into v_event from sm_event e where e.slug = 'sm26';
  select * into v_m from sm_vote_match(v_event, p_first, p_last) limit 1;
  if v_m.status is distinct from 'ok' then return jsonb_build_object('ok', false, 'error', coalesce(v_m.status, 'not_found')); end if;
  if exists (select 1 from sm_public_vote pv where pv.event_id = v_event and pv.voter_key = v_m.voter_key and pv.device_hash is not null) then
    return jsonb_build_object('ok', false, 'error', 'name_already_voted');
  end if;
  for v_comp, v_raw in select k.key, k.value #>> '{}' from jsonb_each(coalesce(p_choices, '{}'::jsonb)) k loop
    if not sm_vote_is_live(v_event, v_comp) then v_results := v_results || jsonb_build_object(v_comp, 'closed'); continue; end if;
    if v_raw is null or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_results := v_results || jsonb_build_object(v_comp, 'invalid_entry'); continue;
    end if;
    if not exists (select 1 from sm_vote_entry ve where ve.event_id = v_event and ve.competition = v_comp and ve.role_assignment_id = v_raw::uuid and ve.removed_at is null) then
      v_results := v_results || jsonb_build_object(v_comp, 'invalid_entry'); continue;
    end if;
    select * into v_row from sm_public_vote pv where pv.event_id = v_event and pv.competition = v_comp and pv.voter_key = v_m.voter_key;
    if v_row.id is not null then
      update sm_public_vote pv set entry_role_assignment_id = v_raw::uuid, updated_at = now(), cast_by = auth.uid() where pv.id = v_row.id;
      v_results := v_results || jsonb_build_object(v_comp, 'changed');
    else
      insert into sm_public_vote (event_id, competition, entry_role_assignment_id, voter_key, voter_id, voter_name, device_hash, cast_by, created_at, updated_at)
      values (v_event, v_comp, v_raw::uuid, v_m.voter_key, v_m.voter_id, v_m.display_name, null, auth.uid(), now(), now())
      on conflict do nothing;
      v_results := v_results || jsonb_build_object(v_comp, 'voted');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'name', v_m.display_name, 'results', v_results);
end $function$;

create or replace function public.sm_admin_vote_reset_limits()
returns integer
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n int;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  delete from sm_vote_attempt a using sm_event e where e.id = a.event_id and e.slug = 'sm26' and not a.ok;
  get diagnostics n = row_count;
  return n;
end $function$;

-- 8. Grants -------------------------------------------------------------------
-- New functions are PUBLIC-executable by default in this project: say who may
-- call each one.

revoke execute on function public.sm_vote_match(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.sm_vote_ip_hash(uuid) from public, anon, authenticated;
revoke execute on function public.sm_vote_tokens(text) from public, anon, authenticated;
grant execute on function public.sm_vote_match(uuid, text, text) to service_role;

grant execute on function public.sm_vote_is_live(uuid, text) to anon, authenticated, service_role;
grant execute on function public.sm_public_vote_status() to anon, authenticated, service_role;
grant execute on function public.sm_public_ballot(text) to anon, authenticated, service_role;
grant execute on function public.sm_public_cast_votes(text, text, text, jsonb) to anon, authenticated, service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.sm_vote_tally(uuid, text)',
    'public.sm_admin_vote_voters(uuid, text, uuid)',
    'public.sm_admin_vote_void(uuid, boolean)',
    'public.sm_admin_vote_check_name(text, text)',
    'public.sm_admin_vote_add_voter(text, text, text)',
    'public.sm_admin_vote_desk_list()',
    'public.sm_admin_vote_remove_voter(uuid)',
    'public.sm_admin_vote_cast_for(text, text, jsonb)',
    'public.sm_admin_vote_reset_limits()',
    'public.sm_admin_vote_sync(boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- 9. First copy of the lists ---------------------------------------------------
-- Taken now so the vote works as soon as staff open it; staff re-sync after the
-- final attendee list is imported (preview first).

insert into public.sm_vote_voter (event_id, source, attendee_id, first_name, last_name)
select a.event_id, 'list', a.id, coalesce(nullif(trim(a.first_name), ''), ''), coalesce(nullif(trim(a.last_name), ''), '')
  from public.sm_attendee a
  join public.sm_registration r on r.id = a.registration_id
  join public.sm_event e on e.id = a.event_id and e.slug = 'sm26'
 where a.attending and r.status = 'confirmed'
on conflict (event_id, attendee_id) where attendee_id is not null do nothing;

insert into public.sm_vote_entry (event_id, competition, role_assignment_id, title, subtitle)
select e.id, c.competition, ra.id,
       coalesce(nullif(trim(r.company_name), ''), nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), 'Entry'),
       coalesce(sp.stage, ae.category, '')
  from public.sm_event e
  join (select distinct a.event_id, a.competition from public.sm_award a where a.type = 'public' and not a.hidden) c on c.event_id = e.id
  join public.sm_role_assignment ra on ra.event_id = e.id and ra.role = any(public.sm_vote_roles(c.competition)) and ra.status <> 'declined'
  join public.sm_registration r on r.id = ra.registration_id and r.status not in ('declined', 'cancelled')
  left join public.sm_startup_profile sp on sp.role_assignment_id = ra.id
  left join public.sm_architecture_entry ae on ae.role_assignment_id = ra.id
 where e.slug = 'sm26'
on conflict (event_id, competition, role_assignment_id) do nothing;
