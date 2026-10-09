-- DRY RUN of supabase/migrations/20261009160000_search_fold_columns.sql.
-- NOT A MIGRATION: never apply it, never commit it to the database.
--
-- Run it as ONE query text (one implicit transaction). The last statement ends
-- with RAISE EXCEPTION 'DRYRUN ...': the report is the error message, and
-- everything (the DDL, the test UPDATEs and INSERTs) rolls back.
-- Tripwire: if the report starts with "FAIL before-snapshot missing", the
-- statements did NOT run in one transaction and the migration may have been
-- committed: check information_schema.columns for name_search at once.
--
-- Real ids, looked up read-only on 9 Oct 2026:
--   "gocek" once folded (all verified, no owner):
--     488802eb-20c7-4322-959e-cd8fbd1baa0e  D-Marin Göcek
--     09bb315f-1d6b-44d0-80b0-69649d0bfc6d  Setur Gocek Exclusive Marina
--     4e2328fe-d6ff-4d8f-b4f6-05f83d27de5c  Setur Gocek Village Port
--   owner, not staff: user 97f21221-dec9-48a0-b8b8-f2de4d4c0bdb owns
--     9b4a28b0-7a82-4638-ba2e-99e94a15cd6b  Yacht Club de Monaco
--   outsider, verified, not staff, not a member of that company:
--     0f8c900e-5e63-404c-96ca-58a0718541a8
--   verified admin (is_moderator()): 9e51b498-d4d9-4a66-91f5-0c4e66185179
--   the only resources whose folded title contains "egypt's" (published, public):
--     7f94ac1c-4005-442a-848c-c986957316de  Egypt’s Yachting Ambitions at the Monaco Smart Marina Rendezvous
--     aaed74be-66ec-4ba4-87f7-0a9b9a1664bf  What Is Driving Egypt’s Marina Development Wave?
--   event f55f7b2f-96ac-4c5e-b620-358624e52240
--     "Monaco Smart & Sustainable Marina — 6th Edition" (published, public)

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Before the migration: what anon and an ordinary member see, the policies,
--    and the column privileges of anon / authenticated on the three tables.
-- ────────────────────────────────────────────────────────────────────────────
do $before$
declare
  v_anon text;
  v_member text;
  v_policies text;
  v_privs text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  v_anon := format('organizations=%s resources=%s events=%s',
    (select count(*) from public.organizations),
    (select count(*) from public.resources),
    (select count(*) from public.events));
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', '0f8c900e-5e63-404c-96ca-58a0718541a8', 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_member := format('organizations=%s resources=%s events=%s',
    (select count(*) from public.organizations),
    (select count(*) from public.resources),
    (select count(*) from public.events));
  reset role;
  perform set_config('request.jwt.claims', '', true);

  select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles, qual, with_check),
                                 ';' order by tablename, policyname), ''))
    into v_policies
    from pg_policies
   where schemaname = 'public' and tablename in ('organizations', 'resources', 'events');

  select md5(coalesce(string_agg(format('%s|%s|%s|%s', table_name, column_name, grantee, privilege_type),
                                 ';' order by table_name, column_name, grantee, privilege_type), ''))
    into v_privs
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name in ('organizations', 'resources', 'events')
     and grantee in ('anon', 'authenticated');

  perform set_config('smc_dryrun.anon_before', v_anon, true);
  perform set_config('smc_dryrun.member_before', v_member, true);
  perform set_config('smc_dryrun.policies_before', v_policies, true);
  perform set_config('smc_dryrun.privs_before', v_privs, true);
end
$before$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The migration body, verbatim.
-- ────────────────────────────────────────────────────────────────────────────
set local lock_timeout = '5s';

create or replace function public.smc_fold(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path to ''
as $fn$
  select pg_catalog.lower(
    pg_catalog.translate(
      public.unaccent('public.unaccent'::regdictionary, p),
      '‘’ʼ`´′‐‑‒–—―',
      $$''''''------$$
    )
  );
$fn$;

comment on function public.smc_fold(text) is
  'Search fold: lower(unaccent(x)), curly apostrophes and long dashes made plain. Source of the *_search generated columns; src/lib/searchSuggestions.ts fold() must match it.';

grant execute on function public.smc_fold(text) to anon, authenticated, service_role;

alter table public.organizations
  add column if not exists name_search text generated always as (public.smc_fold(name)) stored;
alter table public.resources
  add column if not exists title_search text generated always as (public.smc_fold(title)) stored;
alter table public.events
  add column if not exists title_search text generated always as (public.smc_fold(title)) stored;

comment on column public.organizations.name_search is
  'smc_fold(name), generated: what the search compares (accents, case and apostrophe kinds ignored).';
comment on column public.resources.title_search is
  'smc_fold(title), generated: what the search compares (accents, case and apostrophe kinds ignored).';
comment on column public.events.title_search is
  'smc_fold(title), generated: what the search compares (accents, case and apostrophe kinds ignored).';

-- organizations is read column by column (claim_code withheld): the copy of `name` is readable like `name`.
grant select (name_search) on public.organizations to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The checks. Every one in its own BEGIN ... EXCEPTION block (a failing one
--    is reported, its role and claims roll back, the next one runs).
-- ────────────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  nl constant text := chr(10);
  r text := '';
  v text;
  w text;
  n bigint;
  m bigint;
  ids uuid[];
  c_gocek constant uuid[] := array[
    '488802eb-20c7-4322-959e-cd8fbd1baa0e',
    '09bb315f-1d6b-44d0-80b0-69649d0bfc6d',
    '4e2328fe-d6ff-4d8f-b4f6-05f83d27de5c']::uuid[];
  c_owner constant uuid := '97f21221-dec9-48a0-b8b8-f2de4d4c0bdb';
  c_owner_org constant uuid := '9b4a28b0-7a82-4638-ba2e-99e94a15cd6b';
  c_outsider constant uuid := '0f8c900e-5e63-404c-96ca-58a0718541a8';
  c_admin constant uuid := '9e51b498-d4d9-4a66-91f5-0c4e66185179';
  c_egypt constant uuid[] := array[
    '7f94ac1c-4005-442a-848c-c986957316de',
    'aaed74be-66ec-4ba4-87f7-0a9b9a1664bf']::uuid[];
  c_article constant uuid := 'aaed74be-66ec-4ba4-87f7-0a9b9a1664bf';
  c_event constant uuid := 'f55f7b2f-96ac-4c5e-b620-358624e52240';
  c_gocek_org constant uuid := '488802eb-20c7-4322-959e-cd8fbd1baa0e';
  v_anon_before constant text := current_setting('smc_dryrun.anon_before', true);
  v_member_before constant text := current_setting('smc_dryrun.member_before', true);
  v_policies_before constant text := current_setting('smc_dryrun.policies_before', true);
  v_privs_before constant text := current_setting('smc_dryrun.privs_before', true);
begin
  -- T0 tripwire: block 0 ran in this same transaction.
  r := r || nl || case when coalesce(v_anon_before, '') <> '' and coalesce(v_privs_before, '') <> ''
                       then 'PASS before-snapshot present (one transaction)'
                       else 'FAIL before-snapshot missing: NOT one transaction, the migration may be COMMITTED' end;

  -- T1 the function: immutable, parallel safe, strict, empty search_path (the same setting as is_moderator()).
  begin
    select format('volatile=%s parallel=%s strict=%s config=%s', p.provolatile, p.proparallel, p.proisstrict, p.proconfig)
      into v from pg_proc p where p.oid = 'public.smc_fold(text)'::regprocedure;
    r := r || nl || case when v = format('volatile=i parallel=s strict=t config=%s',
                                         (select q.proconfig from pg_proc q where q.oid = 'public.is_moderator()'::regprocedure))
                         then 'PASS ' else 'FAIL ' end || 'smc_fold shape: ' || coalesce(v, '(missing)');
  exception when others then
    r := r || nl || 'FAIL smc_fold shape: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T2 the fold (same strings the browser's fold was checked against).
  begin
    r := r || nl || case when public.smc_fold('Sète') = 'sete' then 'PASS ' else 'FAIL ' end
              || 'smc_fold(Sète) = ' || public.smc_fold('Sète');
    r := r || nl || case when public.smc_fold('D-Marin Göcek') = 'd-marin gocek' then 'PASS ' else 'FAIL ' end
              || 'smc_fold(D-Marin Göcek) = ' || public.smc_fold('D-Marin Göcek');
    r := r || nl || case when public.smc_fold('Egypt’s') = 'egypt''s' then 'PASS ' else 'FAIL ' end
              || 'smc_fold(Egypt’s) = ' || public.smc_fold('Egypt’s');
    r := r || nl || case when public.smc_fold('Kuşadası Øresund Straße Œuvre Łódź Đakovo Þór Æro ẞ')
                              = 'kusadasi oresund strasse oeuvre lodz dakovo thor aero ss' then 'PASS ' else 'FAIL ' end
              || 'smc_fold(letters NFD keeps whole) = ' || public.smc_fold('Kuşadası Øresund Straße Œuvre Łódź Đakovo Þór Æro ẞ');
    r := r || nl || case when public.smc_fold('Monaco Smart & Sustainable Marina — 6th Edition')
                              = 'monaco smart & sustainable marina - 6th edition' then 'PASS ' else 'FAIL ' end
              || 'smc_fold(em dash) = ' || public.smc_fold('Monaco Smart & Sustainable Marina — 6th Edition');
    r := r || nl || case when public.smc_fold('İstanbul ‘Côte’ d´Azur `x` ′') = 'istanbul ''cote'' d''azur ''x'' '''
                         then 'PASS ' else 'FAIL ' end
              || 'smc_fold(apostrophes) = ' || public.smc_fold('İstanbul ‘Côte’ d´Azur `x` ′');
    r := r || nl || case when public.smc_fold('e' || chr(769) || 'cole') = 'ecole' then 'PASS ' else 'FAIL ' end
              || 'smc_fold(decomposed é) = ' || public.smc_fold('e' || chr(769) || 'cole');
    r := r || nl || case when public.smc_fold(null) is null then 'PASS ' else 'FAIL ' end || 'smc_fold(null) is null';
  exception when others then
    r := r || nl || 'FAIL smc_fold values: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T3 the copies were filled for every existing row (as postgres).
  begin
    select count(*) filter (where name_search is distinct from public.smc_fold(name)), count(*)
      into n, m from public.organizations;
    r := r || nl || case when n = 0 and m > 0 then 'PASS ' else 'FAIL ' end
              || format('organizations.name_search filled: %s rows, %s differ', m, n);
    select count(*) filter (where title_search is distinct from public.smc_fold(title)), count(*)
      into n, m from public.resources;
    r := r || nl || case when n = 0 and m > 0 then 'PASS ' else 'FAIL ' end
              || format('resources.title_search filled: %s rows, %s differ', m, n);
    select count(*) filter (where title_search is distinct from public.smc_fold(title)), count(*)
      into n, m from public.events;
    r := r || nl || case when n = 0 and m > 0 then 'PASS ' else 'FAIL ' end
              || format('events.title_search filled: %s rows, %s differ', m, n);
  exception when others then
    r := r || nl || 'FAIL backfill: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T4 nothing granted but the column: policies identical, other column privileges identical.
  begin
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', tablename, policyname, cmd, roles, qual, with_check),
                                   ';' order by tablename, policyname), ''))
      into v from pg_policies
     where schemaname = 'public' and tablename in ('organizations', 'resources', 'events');
    r := r || nl || case when v = v_policies_before then 'PASS ' else 'FAIL ' end || 'RLS policies unchanged';

    select md5(coalesce(string_agg(format('%s|%s|%s|%s', table_name, column_name, grantee, privilege_type),
                                   ';' order by table_name, column_name, grantee, privilege_type), ''))
      into v from information_schema.column_privileges
     where table_schema = 'public'
       and table_name in ('organizations', 'resources', 'events')
       and grantee in ('anon', 'authenticated')
       and column_name not in ('name_search', 'title_search');
    r := r || nl || case when v = v_privs_before then 'PASS ' else 'FAIL ' end
              || 'column privileges of anon/authenticated on the other columns unchanged';

    select string_agg(format('%s.%s %s %s', table_name, column_name, grantee, privilege_type), ', '
                      order by table_name, column_name, grantee, privilege_type)
      into v from information_schema.column_privileges
     where table_schema = 'public'
       and table_name in ('organizations', 'resources', 'events')
       and grantee in ('anon', 'authenticated')
       and column_name in ('name_search', 'title_search');
    r := r || nl || 'INFO privileges on the new columns: ' || coalesce(v, '(none)');

    r := r || nl || case when has_column_privilege('anon', 'public.organizations', 'name_search', 'SELECT')
                           and has_column_privilege('authenticated', 'public.organizations', 'name_search', 'SELECT')
                           and not has_column_privilege('anon', 'public.organizations', 'claim_code', 'SELECT')
                           and not has_column_privilege('authenticated', 'public.organizations', 'claim_code', 'SELECT')
                         then 'PASS ' else 'FAIL ' end
              || 'organizations: name_search readable by anon/authenticated, claim_code still not';
    r := r || nl || case when has_function_privilege('authenticated', 'public.smc_fold(text)', 'EXECUTE')
                           and has_function_privilege('service_role', 'public.smc_fold(text)', 'EXECUTE')
                         then 'PASS ' else 'FAIL ' end || 'smc_fold executable by the writers (authenticated, service_role)';
  exception when others then
    r := r || nl || 'FAIL grants/policies: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T5 anon: same rows visible as before the migration.
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    v := format('organizations=%s resources=%s events=%s',
      (select count(*) from public.organizations),
      (select count(*) from public.resources),
      (select count(*) from public.events));
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || case when v = v_anon_before then 'PASS ' else 'FAIL ' end
              || 'anon visibility unchanged: before ' || coalesce(v_anon_before, '?') || ' / after ' || v;
  exception when others then
    r := r || nl || 'FAIL anon visibility: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T6 anon: "gocek" finds the three spellings (the suggestion query's filters), the name alone finds two.
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    select array_agg(id order by id) into ids
      from public.organizations
     where access_status = 'verified' and name_search like '%gocek%';
    select count(*) into n
      from public.organizations
     where access_status = 'verified' and name ilike '%gocek%';
    select count(*) into m
      from (select id, slug, name, organization_type, logo_url, country, headquarters_country, owner_user_id
              from public.organizations
             where access_status = 'verified' and name_search ilike '%gocek%' and name_search ilike '% gocek%'
             order by name limit 12) q;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || case when ids = (select array_agg(u order by u) from unnest(c_gocek) u) then 'PASS ' else 'FAIL ' end
              || format('anon name_search like %%gocek%%: %s rows %s (name ilike finds %s; word-start query %s)',
                        coalesce(array_length(ids, 1), 0), ids, n, m);
  exception when others then
    r := r || nl || 'FAIL anon gocek: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T7 anon: articles and events by their folded titles.
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    select array_agg(id order by id) into ids
      from public.resources
     where published = true and title_search ilike '%egypt''s%';
    select title_search into v from public.events where id = c_event;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || case when ids = (select array_agg(u order by u) from unnest(c_egypt) u)
                         then 'PASS ' else 'FAIL ' end
              || format('anon resources title_search ilike %%egypt''s%%: %s', ids);
    r := r || nl || case when v = 'monaco smart & sustainable marina - 6th edition' then 'PASS ' else 'FAIL ' end
              || 'anon events.title_search = ' || coalesce(v, '(null)');
  exception when others then
    r := r || nl || 'FAIL anon articles/events: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T8 deny: anon still cannot read claim_code.
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    perform claim_code from public.organizations limit 1;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || 'FAIL anon can read organizations.claim_code';
  exception when others then
    r := r || nl || case when sqlstate = '42501' then 'PASS ' else 'FAIL ' end
              || 'anon cannot read organizations.claim_code (' || sqlstate || ')';
  end;

  -- T9 deny: nobody writes the copy (anon).
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    update public.organizations set name_search = 'x' where id = c_owner_org;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || 'FAIL anon UPDATE name_search was accepted';
  exception when others then
    r := r || nl || case when sqlstate = '428C9' then 'PASS ' else 'FAIL ' end
              || 'anon cannot write name_search (' || sqlstate || ' ' || sqlerrm || ')';
  end;

  -- T10 ordinary member (the outsider): same rows visible as before.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', c_outsider, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v := format('organizations=%s resources=%s events=%s',
      (select count(*) from public.organizations),
      (select count(*) from public.resources),
      (select count(*) from public.events));
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || case when v = v_member_before then 'PASS ' else 'FAIL ' end
              || 'authenticated (outsider) visibility unchanged: before ' || coalesce(v_member_before, '?') || ' / after ' || v;
  exception when others then
    r := r || nl || 'FAIL outsider visibility: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T11 owner (authenticated, not staff): no-op UPDATE of the company name, through RLS and the guard trigger.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select name_search into w from public.organizations where id = c_owner_org;
    update public.organizations set name = name where id = c_owner_org returning name_search into v;
    get diagnostics n = row_count;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || case when n = 1 and v = w and v = 'yacht club de monaco' then 'PASS ' else 'FAIL ' end
              || format('owner no-op UPDATE organizations: %s row, name_search %s', n, v);
  exception when others then
    r := r || nl || 'FAIL owner no-op UPDATE: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T12 owner renames: the copy follows, smc_fold runs as authenticated. Undone at once
  --     (the inner block raises 'dryrun-undo'; plpgsql variables keep their values).
  begin
    v := null; n := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.organizations set name = 'Yacht Club de Monaco – Sète' where id = c_owner_org returning name_search into v;
      get diagnostics n = row_count;
      raise exception 'dryrun-undo';
    exception when raise_exception then
      if sqlerrm <> 'dryrun-undo' then raise; end if;
    end;
    r := r || nl || case when n = 1 and v = 'yacht club de monaco - sete' then 'PASS ' else 'FAIL ' end
              || format('owner rename (undone): %s row, name_search %s', n, v);
  exception when others then
    r := r || nl || 'FAIL owner rename: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T13 deny: the owner cannot write the copy.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.organizations set name_search = 'x' where id = c_owner_org;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || 'FAIL owner UPDATE name_search was accepted';
  exception when others then
    r := r || nl || case when sqlstate = '428C9' then 'PASS ' else 'FAIL ' end
              || 'owner cannot write name_search (' || sqlstate || ')';
  end;

  -- T14 deny (RLS unchanged): the outsider updates nothing in someone else's company.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', c_outsider, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.organizations set name = name where id = c_owner_org;
    get diagnostics n = row_count;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end
              || format('outsider UPDATE of another company: %s rows', n);
  exception when others then
    r := r || nl || 'FAIL outsider UPDATE: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T15 deny (RLS unchanged): the owner (not staff) updates no article and no event.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.resources set title = title where id = c_article;
    get diagnostics n = row_count;
    update public.events set title = title where id = c_event;
    get diagnostics m = row_count;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || case when n = 0 and m = 0 then 'PASS ' else 'FAIL ' end
              || format('non-staff UPDATE of resources / events: %s / %s rows', n, m);
  exception when others then
    r := r || nl || 'FAIL non-staff resources/events UPDATE: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T16 staff (authenticated admin): no-op UPDATE of an article and an event, then a retitle of
  --     both, undone at once (inner block raises 'dryrun-undo').
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.resources set title = title where id = c_article;
    get diagnostics n = row_count;
    update public.events set title = title where id = c_event;
    get diagnostics m = row_count;
    v := null; w := null;
    begin
      update public.resources set title = 'Göcek – Egypt’s dry run' where id = c_article
        returning title_search into v;
      update public.events set title = 'Rencontre à Sète' where id = c_event returning title_search into w;
      raise exception 'dryrun-undo';
    exception when raise_exception then
      if sqlerrm <> 'dryrun-undo' then raise; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || case when n = 1 and m = 1 and v = 'gocek - egypt''s dry run' and w = 'rencontre a sete'
                         then 'PASS ' else 'FAIL ' end
              || format('staff UPDATE resources/events: %s/%s rows, retitled (undone) %s | %s', n, m, v, w);
  exception when others then
    r := r || nl || 'FAIL staff resources/events UPDATE: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T17 service role (edge functions, the CRM pull): no-op UPDATE; select * now carries name_search.
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    update public.organizations set name = name where id = c_gocek_org returning name_search into v;
    get diagnostics n = row_count;
    select count(*) into m from (select * from public.organizations) o;
    select string_agg(k, ',' order by k) into w
      from (select jsonb_object_keys(to_jsonb(o)) k from public.organizations o where o.id = c_gocek_org) x
     where k like '%search%';
    reset role;
    perform set_config('request.jwt.claims', '', true);
    r := r || nl || case when n = 1 and v = 'd-marin gocek' then 'PASS ' else 'FAIL ' end
              || format('service_role no-op UPDATE organizations: %s row, %s', n, v);
    r := r || nl || 'INFO service_role select * from organizations: ' || m || ' rows, extra key(s): ' || coalesce(w, '(none)');
  exception when others then
    r := r || nl || 'FAIL service_role: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T18 postgres: no-op UPDATE of a real row of each table.
  begin
    update public.organizations set name = name where id = c_gocek_org returning name_search into v;
    get diagnostics n = row_count;
    r := r || nl || case when n = 1 and v = 'd-marin gocek' then 'PASS ' else 'FAIL ' end
              || format('postgres no-op UPDATE organizations: %s row, %s', n, v);
    update public.resources set title = title where id = c_article returning title_search into v;
    get diagnostics n = row_count;
    r := r || nl || case when n = 1 and v = 'what is driving egypt''s marina development wave?' then 'PASS ' else 'FAIL ' end
              || format('postgres no-op UPDATE resources: %s row, %s', n, v);
    update public.events set title = title where id = c_event returning title_search into v;
    get diagnostics n = row_count;
    r := r || nl || case when n = 1 and v = 'monaco smart & sustainable marina - 6th edition' then 'PASS ' else 'FAIL ' end
              || format('postgres no-op UPDATE events: %s row, %s', n, v);
  exception when others then
    r := r || nl || 'FAIL postgres no-op UPDATE: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T19 postgres: INSERT still works and fills the copy (rolled back; the org insert also runs its entitlement trigger).
  begin
    insert into public.events (title, date_time, published, access_level)
    values ('Rencontre à Sète (dry run)', now(), false, 'public')
    returning title_search into v;
    r := r || nl || case when v = 'rencontre a sete (dry run)' then 'PASS ' else 'FAIL ' end || 'INSERT events: ' || coalesce(v, '(null)');
  exception when others then
    r := r || nl || 'FAIL INSERT events: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    insert into public.resources (title, published)
    values ('Göcek’s marina (dry run)', false)
    returning title_search into v;
    r := r || nl || case when v = 'gocek''s marina (dry run)' then 'PASS ' else 'FAIL ' end || 'INSERT resources: ' || coalesce(v, '(null)');
  exception when others then
    r := r || nl || 'FAIL INSERT resources: ' || sqlstate || ' ' || sqlerrm;
  end;
  begin
    insert into public.organizations (name, slug, access_status)
    values ('Çeşme Marina (dry run)', 'dryrun-accents-' || gen_random_uuid(), 'pending')
    returning name_search into v;
    r := r || nl || case when v = 'cesme marina (dry run)' then 'PASS ' else 'FAIL ' end || 'INSERT organizations: ' || coalesce(v, '(null)');
  exception when others then
    r := r || nl || 'FAIL INSERT organizations: ' || sqlstate || ' ' || sqlerrm;
  end;

  -- T20 deny: an INSERT that names the copy is refused.
  begin
    insert into public.events (title, title_search) values ('x', 'y');
    r := r || nl || 'FAIL INSERT naming title_search was accepted';
  exception when others then
    r := r || nl || case when sqlstate = '428C9' then 'PASS ' else 'FAIL ' end
              || 'INSERT naming title_search refused (' || sqlstate || ')';
  end;

  raise exception 'DRYRUN %', coalesce(r, '(report lost: a NULL was concatenated)');
end
$dryrun$;
