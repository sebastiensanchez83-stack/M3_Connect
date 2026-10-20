-- DRY RUN of supabase/migrations/20261020141000_resource_organization_mention.sql and of its
-- down. NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A. snapshot; B. the migration, verbatim; C. cases as a visitor, a verified member, a
-- moderator and the owner, on a real published public article and real companies, plus two
-- throw-away articles (a draft, a members-only one) created inside the run; every write is
-- rolled back with the cases; D. the down, verbatim; E. checks after the down. No sm_* row is
-- touched; the output names no article and no company.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "19 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot (S01 after the migration and the cases, E02 after the down: both identical)
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'resources', (select md5(coalesce(string_agg(r.id::text || coalesce(r.published::text, '') || coalesce(r.access_level, '')
                          || md5(coalesce(r.content, '')), ',' order by r.id), '')) from public.resources r)
  union all select 'orgs', (select md5(coalesce(string_agg(o.id::text || o.access_status || coalesce(o.archived_at::text, ''), ',' order by o.id), ''))
                              from public.organizations o)
  union all select 'policies', (select md5(string_agg(format('%s.%s.%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname,
                                  pl.cmd, pl.roles, pl.qual, pl.with_check), ';' order by pl.schemaname, pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.tablename <> 'resource_organization_mention')
  union all select 'acls', (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proacl, ','), ''), ';'
                              order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace)
  union all select 'tables', (select md5(string_agg(c.oid::regclass::text || ':' || c.relrowsecurity::text || ':'
                                || coalesce(array_to_string(c.relacl, ','), ''), ';' order by c.oid::regclass::text))
                                from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
                                 and c.relname <> 'resource_organization_mention')
  union all select 'triggers', (select md5(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ','
                                  order by t.tgrelid::regclass::text, t.tgname)) from pg_trigger t where not t.tgisinternal)
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create function pg_temp.dr_claims(p_uid uuid) returns text language sql stable as $f$
  select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', (select u.email from auth.users u where u.id = p_uid))::text
$f$;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', '', true), set_config('request.jwt.claims', '', true);

-- B. The migration, verbatim ─────────────────────────────────────────────────────
-- resource_organization_mention: the companies an article mentions, confirmed by M3 in the
-- article editor (Victor, 20 Oct 2026: "quand un article mentionne une entreprise qui est dans
-- la plateforme il faut que ca la tag et redirige sur son profil quand c'est clique").
-- NOT APPLIED. Apply with Victor's OK, after the dry run
-- supabase/dryrun/20261020141000_resource_organization_mention.dryrun.sql (it runs this file,
-- then its down, in one rolled-back transaction).
-- Down: supabase/migrations/down/20261020141000_resource_organization_mention.down.sql.
--
-- ADDITIVE ONLY: one table, its index and five policies. Nothing existing is redefined, the
-- article's stored HTML is never touched (the article page links the first occurrence of each
-- confirmed name at render time) and the RSS feeds (netlify/edge-functions/rss.ts) do not read
-- it. Independent of every other pending file; any order.
--
-- Who sees a mention: anyone, when the article is published and public and the company is
-- verified, not archived and not merged into another (duplicate_of); signed-in readers also on
-- the published articles they may read (public.can_access_resource, the rule of
-- resource_sectors); M3 staff (public.is_moderator()) all of them. Who writes: M3 staff only
-- (insert and delete; a mention has nothing to update). created_by is stamped by default and is
-- not readable through the API.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.resource_organization_mention') is not null then
    raise exception 'resource_organization_mention: already installed';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.is_moderator()'))
       is distinct from 'cb9c826f94db460c5b63f9830ae12361'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.can_access_resource(text)'))
       is distinct from '2fcf0a1a840a7be68a2fc2467a408c6e' then
    raise exception 'resource_organization_mention: is_moderator() or can_access_resource() changed since 20 Oct; check them again';
  end if;
  if not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'duplicate_of')
     or not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'archived_at') then
    raise exception 'resource_organization_mention: organizations.archived_at / duplicate_of missing';
  end if;
end
$pre$;

create table public.resource_organization_mention (
  resource_id uuid not null references public.resources(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint resource_organization_mention_pkey primary key (resource_id, organization_id)
);
create index resource_organization_mention_org_idx on public.resource_organization_mention (organization_id);
comment on table public.resource_organization_mention is
  'Companies an article mentions, confirmed by M3 staff in the article editor. The article page links the first occurrence of each name to the company page and lists them; the company page lists the public articles that mention it.';

alter table public.resource_organization_mention enable row level security;
revoke all on table public.resource_organization_mention from public, anon, authenticated;
grant select (resource_id, organization_id, created_at) on table public.resource_organization_mention to anon, authenticated;
grant insert (resource_id, organization_id) on table public.resource_organization_mention to authenticated;
grant delete on table public.resource_organization_mention to authenticated;
grant all on table public.resource_organization_mention to service_role;

create policy resource_org_mention_anon_read on public.resource_organization_mention
  for select to anon
  using (
    exists (select 1 from public.resources r
             where r.id = resource_organization_mention.resource_id
               and r.published = true
               and lower(coalesce(r.access_level, 'public')) = 'public')
    and exists (select 1 from public.organizations o
                 where o.id = resource_organization_mention.organization_id
                   and o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null)
  );
create policy resource_org_mention_member_read on public.resource_organization_mention
  for select to authenticated
  using (
    exists (select 1 from public.resources r
             where r.id = resource_organization_mention.resource_id
               and r.published = true
               and public.can_access_resource(r.access_level))
    and exists (select 1 from public.organizations o
                 where o.id = resource_organization_mention.organization_id
                   and o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null)
  );
create policy resource_org_mention_staff_read on public.resource_organization_mention
  for select to authenticated using ((select public.is_moderator()));
create policy resource_org_mention_staff_insert on public.resource_organization_mention
  for insert to authenticated with check ((select public.is_moderator()));
create policy resource_org_mention_staff_delete on public.resource_organization_mention
  for delete to authenticated using ((select public.is_moderator()));

-- After: privileges and policies exactly as intended, else the whole file rolls back.
do $post$
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.resource_organization_mention'::regclass) then
    raise exception 'resource_organization_mention: RLS is off';
  end if;
  if has_column_privilege('anon', 'public.resource_organization_mention', 'created_by', 'select')
     or has_column_privilege('authenticated', 'public.resource_organization_mention', 'created_by', 'select')
     or has_column_privilege('authenticated', 'public.resource_organization_mention', 'created_by', 'insert')
     or has_table_privilege('anon', 'public.resource_organization_mention', 'insert, update, delete')
     or has_table_privilege('authenticated', 'public.resource_organization_mention', 'update')
     or not has_column_privilege('anon', 'public.resource_organization_mention', 'organization_id', 'select')
     or not has_column_privilege('authenticated', 'public.resource_organization_mention', 'organization_id', 'insert')
     or not has_table_privilege('authenticated', 'public.resource_organization_mention', 'delete') then
    raise exception 'resource_organization_mention: wrong privileges';
  end if;
  if (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'resource_organization_mention') <> 5 then
    raise exception 'resource_organization_mention: expected 5 policies';
  end if;
end
$post$;
-- ─────────────────────────────────────────────────────────────────────────────────

-- C. Cases (all inside one block that rolls back at its end; the results survive in arrays)
do $cases$
declare
  v_res uuid; v_draft uuid; v_mres uuid; v_org uuid; v_unl uuid; v_mod uuid; v_mem uuid;
  v_st text; v_n integer; v_n2 integer; v_n3 integer; v_b boolean;
  r_ok boolean[] := '{}';
  r_lb text[] := '{}';
begin
  begin
    -- Fixtures: a published public article and a listed company (live), an unlisted company
    -- (pending, archived or merged), a verified moderator, a verified member who is not staff.
    select r.id into v_res from public.resources r
     where r.published = true and lower(coalesce(r.access_level, 'public')) = 'public' order by r.id limit 1;
    select o.id into v_org from public.organizations o
     where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null order by o.id limit 1;
    select o.id into v_unl from public.organizations o
     where o.access_status <> 'verified' or o.archived_at is not null or o.duplicate_of is not null order by o.id limit 1;
    select p.user_id into v_mod from public.profiles p join auth.users u on u.id = p.user_id
     where p.access_status = 'verified' and p.persona::text in ('admin', 'moderator') order by p.user_id limit 1;
    select p.user_id into v_mem from public.profiles p join auth.users u on u.id = p.user_id
     where p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator') order by p.user_id limit 1;
    -- Two throw-away articles (rolled back): a draft and a published members-only one.
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN mention draft', 'dry run', 'article', false, 'public') returning id into v_draft;
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN mention members', 'dry run', 'article', true, 'members') returning id into v_mres;
    r_ok := r_ok || (v_res is not null and v_org is not null and v_unl is not null and v_mod is not null and v_mem is not null
      and v_draft is not null and v_mres is not null);
    r_lb := r_lb || format('F00 fixtures: public article %s, listed company %s, unlisted company %s, moderator %s, member %s, throw-away articles %s',
      v_res is not null, v_org is not null, v_unl is not null, v_mod is not null, v_mem is not null, v_draft is not null and v_mres is not null);

    -- M01 a moderator confirms a mention; created_by is stamped
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      insert into public.resource_organization_mention (resource_id, organization_id) values (v_res, v_org);
      get diagnostics v_n = row_count;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := 0;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n2 from public.resource_organization_mention m
     where m.resource_id = v_res and m.organization_id = v_org and m.created_by = v_mod;
    r_ok := r_ok || (v_st = 'ok' and v_n = 1 and v_n2 = 1);
    r_lb := r_lb || ('M01 a moderator confirms a mention, created_by stamped: ' || v_st || ', ' || v_n2);

    -- M02 a visitor sees it; M03 but not who created it
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      select count(m.organization_id) into v_n from public.resource_organization_mention m where m.resource_id = v_res;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_n = 1);
    r_lb := r_lb || ('M02 a visitor sees the mention on the public article: ' || v_st || ', ' || v_n);
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      perform m.created_by from public.resource_organization_mention m;
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st like '42501%');
    r_lb := r_lb || ('M03 a visitor cannot read created_by: ' || v_st);

    -- M04 a member sees it; M05 cannot add; M06 cannot remove
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mem), true);
      set local role authenticated;
      select count(m.organization_id) into v_n from public.resource_organization_mention m where m.resource_id = v_res;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_n = 1);
    r_lb := r_lb || ('M04 a signed-in member sees it: ' || v_st || ', ' || v_n);
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mem), true);
      set local role authenticated;
      insert into public.resource_organization_mention (resource_id, organization_id) values (v_draft, v_org);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.resource_organization_mention m where m.resource_id = v_draft;
    r_ok := r_ok || (v_st like '42501 new row violates row-level security policy%' and v_n = 0);
    r_lb := r_lb || ('M05 a member cannot add a mention: ' || v_st || ', rows ' || v_n);
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mem), true);
      set local role authenticated;
      delete from public.resource_organization_mention m where m.resource_id = v_res;
      get diagnostics v_n = row_count;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n2 from public.resource_organization_mention m where m.resource_id = v_res;
    r_ok := r_ok || (v_st = 'ok' and v_n = 0 and v_n2 = 1);
    r_lb := r_lb || ('M06 a member cannot remove it: ' || v_st || ', deleted ' || v_n || ', still ' || v_n2);

    -- M07 a visitor cannot write; M08 nobody updates; M09 nobody sets created_by
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      insert into public.resource_organization_mention (resource_id, organization_id) values (v_draft, v_org);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st like '42501 permission denied for table%');
    r_lb := r_lb || ('M07 a visitor cannot add a mention: ' || v_st);
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      update public.resource_organization_mention set created_at = now() where resource_id = v_res;
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st like '42501 permission denied for table%');
    r_lb := r_lb || ('M08 even a moderator cannot update a mention: ' || v_st);
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      insert into public.resource_organization_mention (resource_id, organization_id, created_by) values (v_draft, v_org, v_mem);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.resource_organization_mention m where m.resource_id = v_draft;
    r_ok := r_ok || (v_st like '42501 permission denied for table%' and v_n = 0);
    r_lb := r_lb || ('M09 nobody chooses created_by: ' || v_st || ', rows ' || v_n);

    -- M10 an unlisted company, M11 a draft, M12 a members-only article (rows added by the owner)
    insert into public.resource_organization_mention (resource_id, organization_id) values (v_res, v_unl), (v_draft, v_org), (v_mres, v_org);
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      select count(*) filter (where m.organization_id = v_unl), count(*) filter (where m.resource_id = v_draft),
             count(*) filter (where m.resource_id = v_mres)
        into v_n, v_n2, v_n3
        from (select m0.resource_id, m0.organization_id from public.resource_organization_mention m0) as m;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_n = 0 and v_n2 = 0 and v_n3 = 0);
    r_lb := r_lb || format('M10 a visitor sees no mention of an unlisted company (%s), on a draft (%s) or on a members-only article (%s): %s',
      v_n, v_n2, v_n3, v_st);
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mem), true);
      set local role authenticated;
      v_b := public.can_access_resource('members');
      select count(*) filter (where m.organization_id = v_unl), count(*) filter (where m.resource_id = v_draft),
             count(*) filter (where m.resource_id = v_mres)
        into v_n, v_n2, v_n3
        from (select m0.resource_id, m0.organization_id from public.resource_organization_mention m0) as m;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_n = 0 and v_n2 = 0 and v_n3 = case when v_b then 1 else 0 end);
    r_lb := r_lb || format('M11 a member: unlisted company %s, draft %s, members-only article %s (may read members-only: %s): %s',
      v_n, v_n2, v_n3, v_b, v_st);
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      select count(*) filter (where m.organization_id = v_unl), count(*) filter (where m.resource_id = v_draft),
             count(*) filter (where m.resource_id = v_mres)
        into v_n, v_n2, v_n3
        from (select m0.resource_id, m0.organization_id from public.resource_organization_mention m0) as m;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_n = 1 and v_n2 = 1 and v_n3 = 1);
    r_lb := r_lb || format('M12 a moderator sees all three: %s, %s, %s (%s)', v_n, v_n2, v_n3, v_st);

    -- M13 the same mention twice is refused (checked after the expected error)
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      insert into public.resource_organization_mention (resource_id, organization_id) values (v_res, v_org);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n from public.resource_organization_mention m where m.resource_id = v_res and m.organization_id = v_org;
    r_ok := r_ok || (v_st like '23505%' and v_n = 1);
    r_lb := r_lb || ('M13 the same mention twice is refused: ' || v_st || ', rows ' || v_n);

    -- M14 a moderator removes it
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      delete from public.resource_organization_mention m where m.resource_id = v_res and m.organization_id = v_org;
      get diagnostics v_n = row_count;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select count(*) into v_n2 from public.resource_organization_mention m where m.resource_id = v_res and m.organization_id = v_org;
    r_ok := r_ok || (v_st = 'ok' and v_n = 1 and v_n2 = 0);
    r_lb := r_lb || ('M14 a moderator removes the mention: ' || v_st || ', deleted ' || v_n || ', left ' || v_n2);

    -- M15 deleting an article removes its mentions
    delete from public.resources r where r.id = v_draft;
    select count(*) into v_n from public.resource_organization_mention m where m.resource_id = v_draft;
    r_ok := r_ok || (v_n = 0);
    r_lb := r_lb || ('M15 deleting an article deletes its mentions: left ' || v_n);

    raise exception using errcode = 'DRY01';
  exception when sqlstate 'DRY01' then null;
  end;
  insert into _dr_res (ok, label) select u.ok, u.lb from unnest(r_ok, r_lb) as u(ok, lb);
end
$cases$;

-- S01 nothing else moved (the fixtures and the cases' writes rolled back)
insert into _dr_res (ok, label)
select not exists ((select k, v from _dr_before) except (select k, v from pg_temp.dr_snap()))
         and (select count(*) from public.resource_organization_mention) = 0,
       'S01 after the migration and the cases: no mention left, resources, organizations, policies, ACLs, tables, triggers unchanged: '
       || coalesce((select string_agg(b.k, ',') from _dr_before b join pg_temp.dr_snap() a on a.k = b.k where a.v is distinct from b.v), 'all equal');

-- D. The down, verbatim ──────────────────────────────────────────────────────────
-- DOWN of supabase/migrations/20261020141000_resource_organization_mention.sql. NOT A
-- MIGRATION: run it only to take the feature out (with Victor's OK). It DROPS every confirmed
-- mention; keep a copy first if any exist:
--   select * from public.resource_organization_mention;
-- The client copes with the table being gone: the article page and the company page simply show
-- no mentions, and the editor's panel says it could not load them.
-- Checked by the same dry run as the migration
-- (supabase/dryrun/20261020141000_resource_organization_mention.dryrun.sql).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop table if exists public.resource_organization_mention;

do $post$
begin
  if to_regclass('public.resource_organization_mention') is not null
     or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'resource_organization_mention') then
    raise exception 'resource_organization_mention down: something is left';
  end if;
end
$post$;
-- ─────────────────────────────────────────────────────────────────────────────────

-- E. Checks after the down, then the report
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (
    to_regclass('public.resource_organization_mention') is null
      and not exists (select 1 from pg_policies p where p.tablename = 'resource_organization_mention'),
    'E01 the down removed the table and its five policies');
  insert into _dr_res (ok, label)
  select not exists ((select k, v from _dr_before) except (select k, v from pg_temp.dr_snap())),
         'E02 after the down: everything back to the snapshot: '
         || coalesce((select string_agg(b.k, ',') from _dr_before b join pg_temp.dr_snap() a on a.k = b.k where a.v is distinct from b.v), 'all equal');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (resource_organization_mention dry run, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
