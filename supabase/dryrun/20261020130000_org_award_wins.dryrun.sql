-- DRY RUN of supabase/migrations/20261020130000_org_award_wins.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, checks (as postgres, as anon, as a signed-in user), the down
-- verbatim, checks again. Writes NO sm_* row: the winner cases run on temp copies (columns needed
-- only) through a copy of the new function's own body pointed at those copies.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "13 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_fn on commit drop as
  select p.oid::regprocedure::text as fn, coalesce(array_to_string(p.proacl, ','), '') as acl, md5(p.prosrc) as m
    from pg_proc p where p.pronamespace = 'public'::regnamespace;
create temp table _dr_sm on commit drop as
  select 'sm_award'::text as t, count(*) as n, md5(coalesce(string_agg(x::text, '|' order by x.id), '')) as m from public.sm_award x
  union all select 'sm_event', count(*), md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.sm_event x
  union all select 'sm_role_assignment', count(*), max(x.updated_at)::text from public.sm_role_assignment x
  union all select 'sm_registration', count(*), max(x.updated_at)::text from public.sm_registration x;

-- B. The migration, verbatim
-- Public read of the Smart Marina award winners, by company (20 Oct 2026, Victor: the winner
-- badge on company pages and directory cards, one of the "ideas before 13 Nov").
-- Down: supabase/migrations/down/20261020130000_org_award_wins.down.sql.
-- Dry run: supabase/dryrun/20261020130000_org_award_wins.dryrun.sql
-- (runs this file, checks it as anon and authenticated, then the down, in one rolled-back transaction).
--
-- sm_award_results(p_event_id) already shows the confirmed winners publicly, but by name only
-- ("winner_title"): a company page cannot tell whether a winner is itself. This adds ONE
-- read-only SECURITY DEFINER function that returns, for every confirmed and visible award whose
-- winning entry belongs to a company page, that page's id and the award's label and edition.
--   - No personal data: no names, no e-mails, no entry texts; only ids already public on
--     /organizations/<slug> and award labels already public on /sm26/vote.
--   - Same filter as sm_award_results: confirmed = true and not hidden. Nothing shows until M3
--     staff choose and confirm a winner in Admin > SM26 > Awards (on 20 Oct none is confirmed).
--   - The company is the entry's own organization_id, else its registration's. A company merged
--     into another (organizations.duplicate_of) answers with the company it was merged into.
--   - Writes nothing, changes no table, no policy, no other function. sm_* stays frozen.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regprocedure('public.org_award_wins()') is not null then
    raise exception 'org_award_wins: the function already exists';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public'
         and (c.table_name, c.column_name) in (('sm_award', 'winner_role_assignment_id'), ('sm_award', 'confirmed'),
              ('sm_award', 'hidden'), ('sm_award', 'label'), ('sm_award', 'key'), ('sm_award', 'competition'),
              ('sm_award', 'type'), ('sm_award', 'sort'), ('sm_award', 'event_id'), ('sm_event', 'start_date'),
              ('sm_event', 'slug'), ('sm_role_assignment', 'organization_id'), ('sm_role_assignment', 'registration_id'),
              ('sm_registration', 'organization_id'), ('organizations', 'duplicate_of'))) <> 15 then
    raise exception 'org_award_wins: a column it reads is missing';
  end if;
end
$pre$;

create function public.org_award_wins()
returns table (
  organization_id uuid,
  award_key text,
  award_label text,
  competition text,
  award_type text,
  edition_year integer,
  event_slug text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(o.duplicate_of, o.id),
         a.key,
         a.label,
         a.competition,
         a.type,
         extract(year from e.start_date)::integer,
         e.slug
    from sm_award a
    join sm_event e on e.id = a.event_id
    join sm_role_assignment ra on ra.id = a.winner_role_assignment_id
    join sm_registration r on r.id = ra.registration_id
    join organizations o on o.id = coalesce(ra.organization_id, r.organization_id)
   where a.confirmed = true
     and not a.hidden
   order by e.start_date desc, a.sort;
$fn$;

comment on function public.org_award_wins() is
  'Confirmed, visible Smart Marina award wins by company page (organization id, award key/label, competition, type, edition year, event slug). Public, read-only; the winner badge on company pages and directory cards. 20261020130000.';

revoke all on function public.org_award_wins() from public;
grant execute on function public.org_award_wins() to anon, authenticated, service_role;

-- C. Checks after the migration
create temp table _dr_sm_award on commit drop as select * from public.sm_award;
create temp table _dr_sm_event on commit drop as select x.id, x.start_date, x.slug from public.sm_event x;
create temp table _dr_sm_role_assignment on commit drop as select x.id, x.registration_id, x.organization_id from public.sm_role_assignment x;
create temp table _dr_sm_registration on commit drop as select x.id, x.organization_id from public.sm_registration x;
create temp table _dr_organizations on commit drop as select x.id, x.duplicate_of from public.organizations x;

do $c$
declare
  v_state text;
  v_txt text;
  v_body text;
  v_n_def bigint;
  v_n_pub bigint;
  v_n_anon bigint;
  v_n_auth bigint;
  v_x uuid;
  v_x_org uuid;
  v_y uuid;
  v_y_org uuid;
  v_z uuid;
  v_p uuid;
  v_p_org uuid;
  v_w uuid;
  v_year integer;
  v_slug text;
begin
  -- C1 shape of the function
  insert into _dr_res (ok, label) values (
    coalesce((select p.prosecdef and p.provolatile = 's' and p.prokind = 'f'
                 and array_to_string(p.proconfig, ';') = 'search_path=public, pg_temp'
                 and p.proowner = (select q.proowner from pg_proc q where q.oid = to_regprocedure('public.sm_award_results(uuid)'))
                 and p.proargnames = array['organization_id', 'award_key', 'award_label', 'competition', 'award_type', 'edition_year', 'event_slug']
                from pg_proc p where p.oid = to_regprocedure('public.org_award_wins()')), false),
    'C1 org_award_wins(): SECURITY DEFINER, STABLE, search_path public, pg_temp, same owner as sm_award_results, 7 columns: '
      || coalesce((select pg_get_userbyid(p.proowner) || ' / ' || array_to_string(p.proconfig, ';') || ' / ' || array_to_string(p.proargnames, ',')
                     from pg_proc p where p.oid = to_regprocedure('public.org_award_wins()')), 'MISSING'));

  -- C2 who may call it
  insert into _dr_res (ok, label) values (
    coalesce(has_function_privilege('anon', 'public.org_award_wins()', 'execute')
      and has_function_privilege('authenticated', 'public.org_award_wins()', 'execute')
      and has_function_privilege('service_role', 'public.org_award_wins()', 'execute')
      and (select p.proacl is not null from pg_proc p where p.oid = to_regprocedure('public.org_award_wins()'))
      and not exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = to_regprocedure('public.org_award_wins()'))) a where a.grantee = 0), false),
    'C2 EXECUTE for anon, authenticated, service_role; none for PUBLIC: '
      || coalesce((select p.proacl::text from pg_proc p where p.oid = to_regprocedure('public.org_award_wins()')), 'null'));

  -- C3 every row is a confirmed winner of the public results page (sm_award_results), same award and edition
  select count(*) into v_n_def from public.org_award_wins();
  select count(*) into v_n_pub from public.sm_event e cross join lateral public.sm_award_results(e.id) w;
  insert into _dr_res (ok, label) values (
    v_n_def <= v_n_pub
      and not exists ((select f.award_key, f.event_slug from public.org_award_wins() f)
                      except (select w.award_key, e.slug from public.sm_event e cross join lateral public.sm_award_results(e.id) w)),
    'C3 ' || v_n_def || ' badge row(s), all among the ' || v_n_pub || ' public winner(s) of sm_award_results');

  -- C4 a visitor (anon) reads the same rows
  begin
    set local role anon;
    select count(*) into v_n_anon from public.org_award_wins();
    v_state := 'ok';
  exception when others then v_state := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  insert into _dr_res (ok, label) values (v_state = 'ok' and v_n_anon = v_n_def,
    'C4 anon calls org_award_wins() -> ' || v_state || ', ' || coalesce(v_n_anon::text, 'null') || ' row(s) (postgres: ' || v_n_def || ')');

  -- C5 a signed-in member (authenticated, any user id) reads the same rows
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n_auth from public.org_award_wins();
    v_state := 'ok';
  exception when others then v_state := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into _dr_res (ok, label) values (v_state = 'ok' and v_n_auth = v_n_def,
    'C5 authenticated calls org_award_wins() -> ' || v_state || ', ' || coalesce(v_n_auth::text, 'null') || ' row(s)');

  -- C6 the function's own body, pointed at the temp copies (no sm_* write anywhere)
  select p.prosrc into v_body from pg_proc p where p.oid = to_regprocedure('public.org_award_wins()');
  v_body := replace(v_body, 'from sm_award a', 'from pg_temp._dr_sm_award a');
  v_body := replace(v_body, 'join sm_event e', 'join pg_temp._dr_sm_event e');
  v_body := replace(v_body, 'join sm_role_assignment ra', 'join pg_temp._dr_sm_role_assignment ra');
  v_body := replace(v_body, 'join sm_registration r ', 'join pg_temp._dr_sm_registration r ');
  v_body := replace(v_body, 'join organizations o', 'join pg_temp._dr_organizations o');
  execute format('create function pg_temp._dr_wins() returns table (organization_id uuid, award_key text, award_label text, competition text, award_type text, edition_year integer, event_slug text) language sql stable as %L', v_body);
  insert into _dr_res (ok, label) values (
    (length(v_body) - length(replace(v_body, 'pg_temp._dr_', ''))) / length('pg_temp._dr_') = 5
      and v_body !~* '(from|join)\s+(sm_|organizations)'
      and (select count(*) from pg_temp._dr_wins()) = v_n_def
      and not exists ((select f.organization_id, f.award_key from pg_temp._dr_wins() f)
                      except (select g.organization_id, g.award_key from public.org_award_wins() g)),
    'C6 the body copy on unchanged temp copies returns what the real function returns (' || v_n_def || ' row(s))');

  -- Fixtures, read from the real entries (ids stay in this transaction)
  select ra.id, ra.organization_id into v_x, v_x_org
    from public.sm_role_assignment ra
   where ra.organization_id is not null and ra.role = any(public.sm_vote_roles('innovation'))
   order by ra.id limit 1;
  select ra.id, r.organization_id into v_y, v_y_org
    from public.sm_role_assignment ra join public.sm_registration r on r.id = ra.registration_id
   where ra.organization_id is null and r.organization_id is not null and r.organization_id is distinct from v_x_org
   order by ra.id limit 1;
  select ra.id into v_z
    from public.sm_role_assignment ra join public.sm_registration r on r.id = ra.registration_id
   where ra.organization_id is null and r.organization_id is null
   order by ra.id limit 1;
  select ra.id, r.organization_id into v_p, v_p_org
    from public.sm_role_assignment ra join public.sm_registration r on r.id = ra.registration_id
   where ra.organization_id is null and r.organization_id is not null
     and r.organization_id is distinct from v_x_org and r.organization_id is distinct from v_y_org
   order by ra.id limit 1;
  select o.id into v_w from public.organizations o
   where o.duplicate_of is null and o.id is distinct from v_x_org and o.id is distinct from v_y_org and o.id is distinct from v_p_org
   order by o.id limit 1;
  insert into _dr_res (ok, label) values (v_x is not null and v_y is not null and v_z is not null and v_p is not null and v_w is not null,
    'C7 fixtures found: an entry with its own company, one with the company on its registration only (twice), one with none, a merge target');

  -- The cases, on the temp copies only
  update pg_temp._dr_sm_award d set winner_role_assignment_id = null, confirmed = false;
  update pg_temp._dr_sm_award d set winner_role_assignment_id = v_x, confirmed = true, hidden = false where d.key = 'innovation_jury';
  update pg_temp._dr_sm_award d set winner_role_assignment_id = v_y, confirmed = true, hidden = false where d.key = 'innovation_public';
  update pg_temp._dr_sm_award d set winner_role_assignment_id = v_z, confirmed = true, hidden = false where d.key = 'architecture_pro_jury';
  update pg_temp._dr_sm_award d set winner_role_assignment_id = v_x, confirmed = false, hidden = false where d.key = 'architecture_pro_public';
  update pg_temp._dr_sm_award d set winner_role_assignment_id = v_y, confirmed = true, hidden = true where d.key = 'architecture_student_jury';
  update pg_temp._dr_sm_award d set winner_role_assignment_id = v_p, confirmed = true, hidden = false where d.key = 'architecture_student_public';
  update pg_temp._dr_organizations d set duplicate_of = v_w where d.id = v_p_org;

  insert into _dr_res (ok, label) values (
    array(select f.award_key from pg_temp._dr_wins() f) = array['innovation_jury', 'innovation_public', 'architecture_student_public'],
    'C8 confirmed + visible + a company only, in award order (unconfirmed, hidden and company-less winners left out): '
      || coalesce(array_to_string(array(select f.award_key from pg_temp._dr_wins() f), ','), 'none'));
  insert into _dr_res (ok, label) values (
    (select count(*) from pg_temp._dr_wins()) = 3
      and not exists ((select f.organization_id, f.award_key from pg_temp._dr_wins() f)
                      except (values (v_x_org, 'innovation_jury'), (v_y_org, 'innovation_public'), (v_w, 'architecture_student_public'))),
    'C9 the company: the entry''s own, else its registration''s; a merged copy answers with the company it was merged into');
  select extract(year from e.start_date)::integer, e.slug into v_year, v_slug
    from public.sm_award a join public.sm_event e on e.id = a.event_id where a.key = 'innovation_jury' limit 1;
  insert into _dr_res (ok, label) values (
    coalesce((select bool_and(f.edition_year = v_year and f.event_slug = v_slug and f.award_label = a.label and f.competition = a.competition and f.award_type = a.type)
                from pg_temp._dr_wins() f join pg_temp._dr_sm_award a on a.key = f.award_key), false),
    'C10 edition ' || coalesce(v_year::text, '?') || ' (' || coalesce(v_slug, '?') || '), label, competition and type copied from the award');

  -- C11 nothing else moved
  insert into _dr_res (ok, label) values (
    not exists ((select s.t, s.n, s.m from _dr_sm s)
                except (select 'sm_award'::text, count(*), md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.sm_award x
                        union all select 'sm_event', count(*), md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.sm_event x
                        union all select 'sm_role_assignment', count(*), max(x.updated_at)::text from public.sm_role_assignment x
                        union all select 'sm_registration', count(*), max(x.updated_at)::text from public.sm_registration x))
      and not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                      except (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                                from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn) + 1,
    'C11 sm_award, sm_event, sm_role_assignment, sm_registration unchanged; every other public function unchanged; one function added');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261020130000_org_award_wins.sql
-- Drops the public read of award winners by company. Nothing else depends on it in the database
-- (checked below); the client treats a missing function as "no winner" (src/lib/awardWins.ts), so
-- the company pages and the directory simply stop showing the badge.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.prosrc ilike '%org_award_wins%'
     and p.oid is distinct from to_regprocedure('public.org_award_wins()')
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_award_wins down: SQL function(s) call it: %', v_bad;
  end if;
end
$pre$;

drop function if exists public.org_award_wins();

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (to_regprocedure('public.org_award_wins()') is null, 'E1 down dropped org_award_wins()');
  insert into _dr_res (ok, label) values (
    not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                except (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                          from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn),
    'E2 public functions back to the snapshot (' || (select count(*) from _dr_fn) || ')');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_award_wins, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
