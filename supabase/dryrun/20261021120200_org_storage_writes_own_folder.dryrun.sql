-- DRY RUN of supabase/migrations/20261021120200_org_storage_writes_own_folder.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- Fixtures are read at run time: company A with a member who is not staff, company B with real
-- logo files and no link to that member, a moderator in neither company, the folders of companies
-- that no longer exist, and a random signed-in id with no company. Five test rows are added as
-- postgres (storage.objects ROWS only: nothing reaches the storage itself). Every write is then
-- tried as its real role (set local role + request.jwt.claims) before the migration, after it and
-- after the down. Each try runs in a sub-transaction that is always undone (pg_temp._dr_try), so no
-- real file row changes even inside this transaction (C13 checks it). Prints counts and SQLSTATEs
-- only. Independent of 20261021120000 and 20261021120100 (applied or not).
-- It holds an exclusive lock on storage.objects from the migration to the end (a second or two).
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "18 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Helpers, snapshot, fixtures, the tries
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_case (n serial, phase text, k text, label text, role text, sub uuid, q text, want text, got text) on commit drop;
create temp table _dr_fx (k text primary key, u uuid, t text) on commit drop;

-- One try: runs p_sql as p_role with auth.uid() = p_sub and returns 'ok:<rows>' or the SQLSTATE.
-- The try always ends on a private error inside its own sub-transaction, so whatever it wrote,
-- and the role and claims it set, are undone before the next try.
create function pg_temp._dr_try(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $f$
declare
  v_n bigint;
  v_state text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
    perform set_config('storage.allow_delete_query', 'true', true);
    execute format('set local role %I', p_role);
    execute p_sql;
    get diagnostics v_n = row_count;
    raise exception using errcode = 'DRY01', message = 'undo';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  if v_state = 'DRY01' then
    return 'ok:' || v_n::text;
  end if;
  return v_state;
end
$f$;

create function pg_temp._dr_run(p_phase text) returns void
language plpgsql as $f$
declare
  v_c record;
  v_got text;
begin
  for v_c in select c.n, c.role, c.sub, c.q from pg_temp._dr_case c where c.phase = p_phase order by c.n loop
    v_got := pg_temp._dr_try(v_c.role, v_c.sub, v_c.q);
    update pg_temp._dr_case c set got = v_got where c.n = v_c.n;
  end loop;
end
$f$;

-- One result line per group of tries (k); a try with no expected value is only recorded.
create function pg_temp._dr_check(p_phase text) returns void
language plpgsql as $f$
begin
  insert into pg_temp._dr_res (ok, label)
  select coalesce(bool_and(c.got = c.want) filter (where c.want is not null), true) and bool_and(c.got is not null),
         c.k || ': ' || string_agg(c.label || ' ' || coalesce(c.got, 'not run')
                                     || case when c.want is null then ' (recorded)'
                                             when c.got = c.want then ''
                                             else ' (want ' || c.want || ')' end,
                                   '; ' order by c.n)
    from pg_temp._dr_case c
   where c.phase = p_phase
   group by c.k
   order by min(c.n);
end
$f$;
create function pg_temp._dr_new(p_folder text, p_ext text) returns text language sql as $f$
  select p_folder || '/dryrun-' || gen_random_uuid()::text || '.' || p_ext
$f$;
create function pg_temp._dr_ins(p_bucket text, p_name text, p_uid uuid) returns text language sql as $f$
  select format('insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values (%L, %L, %L::uuid, %L, %L::jsonb)',
                p_bucket, p_name, p_uid, p_uid::text,
                case when p_bucket = 'org-documents' then '{"size": 1000, "mimetype": "application/pdf"}'
                     else '{"size": 1000, "mimetype": "image/png"}' end)
$f$;
create function pg_temp._dr_upd(p_bucket text, p_name text) returns text language sql as $f$
  select format('update storage.objects set metadata = metadata where bucket_id = %L and name = %L', p_bucket, p_name)
$f$;
create function pg_temp._dr_upd_dir(p_bucket text, p_dir text, p_skip text) returns text language sql as $f$
  select format('update storage.objects set metadata = metadata where bucket_id = %L and (storage.foldername(name))[1] = %L and name <> %L',
                p_bucket, p_dir, p_skip)
$f$;
create function pg_temp._dr_del(p_bucket text, p_name text) returns text language sql as $f$
  select format('delete from storage.objects where bucket_id = %L and name = %L', p_bucket, p_name)
$f$;
create function pg_temp._dr_del_dir(p_bucket text, p_dir text, p_skip text) returns text language sql as $f$
  select format('delete from storage.objects where bucket_id = %L and (storage.foldername(name))[1] = %L and name <> %L',
                p_bucket, p_dir, p_skip)
$f$;
create function pg_temp._dr_mv(p_bucket text, p_name text, p_to text) returns text language sql as $f$
  select format('update storage.objects set name = %L where bucket_id = %L and name = %L', p_to, p_bucket, p_name)
$f$;
create function pg_temp._dr_sel(p_bucket text, p_name text) returns text language sql as $f$
  select format('select name from storage.objects where bucket_id = %L and name = %L', p_bucket, p_name)
$f$;

create temp table _dr_pol on commit drop as
  select p.policyname::text as n, p.cmd, p.roles::text as r, p.permissive, coalesce(p.qual, '') as q, coalesce(p.with_check, '') as w
    from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects';
create temp table _dr_obj on commit drop as
  select o.id, o.bucket_id, o.name, o.owner_id, md5(coalesce(o.metadata::text, '')) as m, o.updated_at
    from storage.objects o where o.bucket_id in ('org-logos', 'org-documents');

do $a$
declare
  v_org_a uuid;
  v_mem uuid;
  v_org_b uuid;
  v_mod uuid;
  v_str uuid := gen_random_uuid();
  v_a text;
  v_b text;
  v_b_real bigint;
  v_real_logo text;
  v_orphan_all bigint;
  v_orphan_dirs bigint;
  v_orphan_names text[];
  v_orphan text;
  v_q_orphan_upd text;
  v_q_orphan_del text;
  v_la text;
  v_lb text;
  v_lo text;
  v_da text;
  v_db text;
  v_n_logos bigint;
  v_k text;
begin
  -- Company A and a member of it who is not staff
  select m.organization_id, m.user_id into v_org_a, v_mem
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join auth.users u on u.id = m.user_id
   where not exists (select 1 from public.profiles p
                      where p.user_id = m.user_id and p.access_status = 'verified'
                        and p.persona::text in ('admin', 'moderator'))
   order by m.organization_id, m.user_id
   limit 1;
  -- Company B: real logo files, no link to that member
  select o.id into v_org_b
    from public.organizations o
   where o.id <> v_org_a
     and not exists (select 1 from public.organization_members m where m.organization_id = o.id and m.user_id = v_mem)
     and exists (select 1 from storage.objects ob
                  where ob.bucket_id = 'org-logos' and (storage.foldername(ob.name))[1] = o.id::text)
   order by o.id
   limit 1;
  -- A moderator in neither company
  select p.user_id into v_mod
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where p.access_status = 'verified' and p.persona::text in ('admin', 'moderator')
     and not exists (select 1 from public.organization_members m
                      where m.user_id = p.user_id and m.organization_id in (v_org_a, v_org_b))
   order by p.user_id
   limit 1;
  if v_org_a is null or v_org_b is null or v_mod is null then
    raise exception 'DRYRUN 0 PASS, 1 FAIL (fixtures missing: company A and member %, company B %, moderator %)',
      v_org_a is not null, v_org_b is not null, v_mod is not null;
  end if;
  v_a := v_org_a::text;
  v_b := v_org_b::text;
  select count(*), min(ob.name) into v_b_real, v_real_logo
    from storage.objects ob where ob.bucket_id = 'org-logos' and (storage.foldername(ob.name))[1] = v_b;
  -- Folders of companies that no longer exist (both buckets counted, org-logos files tried)
  select count(*), count(distinct (storage.foldername(ob.name))[1]) into v_orphan_all, v_orphan_dirs
    from storage.objects ob
   where ob.bucket_id in ('org-logos', 'org-documents')
     and not exists (select 1 from public.organizations o where o.id::text = (storage.foldername(ob.name))[1]);
  v_orphan_names := array(select ob.name from storage.objects ob
                           where ob.bucket_id = 'org-logos'
                             and not exists (select 1 from public.organizations o where o.id::text = (storage.foldername(ob.name))[1])
                           order by ob.name);
  v_orphan := coalesce((select (storage.foldername(x.nm))[1] from unnest(v_orphan_names) as x(nm) order by 1 limit 1),
                       gen_random_uuid()::text);
  v_q_orphan_upd := format('update storage.objects set metadata = metadata where bucket_id = %L and name = any(%L::text[])',
                           'org-logos', v_orphan_names);
  v_q_orphan_del := format('delete from storage.objects where bucket_id = %L and name = any(%L::text[])',
                           'org-logos', v_orphan_names);

  -- Five test rows, as postgres
  v_la := pg_temp._dr_new(v_a, 'png');
  v_lb := pg_temp._dr_new(v_b, 'png');
  v_lo := pg_temp._dr_new(v_orphan, 'png');
  v_da := pg_temp._dr_new(v_a, 'pdf');
  v_db := pg_temp._dr_new(v_b, 'pdf');
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
    ('org-logos', v_la, v_mem, v_mem::text, '{"size": 1000, "mimetype": "image/png"}'::jsonb),
    ('org-logos', v_lb, null, null, '{"size": 1000, "mimetype": "image/png"}'::jsonb),
    ('org-logos', v_lo, null, null, '{"size": 1000, "mimetype": "image/png"}'::jsonb),
    ('org-documents', v_da, v_mem, v_mem::text, '{"size": 1000, "mimetype": "application/pdf"}'::jsonb),
    ('org-documents', v_db, null, null, '{"size": 1000, "mimetype": "application/pdf"}'::jsonb);
  insert into _dr_fx (k, t) values ('la', v_la), ('lb', v_lb), ('lo', v_lo), ('da', v_da), ('db', v_db);
  select count(*) into v_n_logos from storage.objects ob where ob.bucket_id = 'org-logos';

  insert into _dr_res (ok, label) values (true,
    format('F0 fixtures: a member (not staff) of company A; company B with %s real logo file(s), no link to that member; '
           || 'a moderator in neither; %s file(s) in %s folder(s) of companies that no longer exist (%s tried, org-logos)',
           v_b_real, v_orphan_all, v_orphan_dirs, coalesce(cardinality(v_orphan_names), 0)));

  -- Before the migration: the hole
  v_k := 'B1 today any signed-in account writes in another company''s folders (the hole)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('b', v_k, 'no-company account inserts a logo into B', 'authenticated', v_str,
     pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_b, 'png'), v_str), 'ok:1'),
    ('b', v_k, 'overwrites B''s real logos', 'authenticated', v_str, pg_temp._dr_upd_dir('org-logos', v_b, v_lb), 'ok:' || v_b_real::text),
    ('b', v_k, 'deletes a logo of B', 'authenticated', v_str, pg_temp._dr_del('org-logos', v_lb), 'ok:1'),
    ('b', v_k, 'uploads a document into B', 'authenticated', v_str,
     pg_temp._dr_ins('org-documents', pg_temp._dr_new(v_b, 'pdf'), v_str), 'ok:1');

  -- After the migration
  v_k := 'C02 a member writes in its own company''s folder, org-logos (main OrganizationTab.tsx:179/222/267, refonte orgActions.ts:44/80)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'insert a logo', 'authenticated', v_mem, pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_a, 'png'), v_mem), 'ok:1'),
    ('c', v_k, 'replace it (upsert)', 'authenticated', v_mem, pg_temp._dr_upd('org-logos', v_la), 'ok:1'),
    ('c', v_k, 'delete it', 'authenticated', v_mem, pg_temp._dr_del('org-logos', v_la), 'ok:1');
  v_k := 'C03 a member writes in its own company''s folder, org-documents (main OrganizationTab.tsx:316/319, refonte orgActions.ts:162/165)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'upload a document', 'authenticated', v_mem, pg_temp._dr_ins('org-documents', pg_temp._dr_new(v_a, 'pdf'), v_mem), 'ok:1'),
    ('c', v_k, 'read it for the signed link', 'authenticated', v_mem, pg_temp._dr_sel('org-documents', v_da), 'ok:1'),
    ('c', v_k, 'delete it', 'authenticated', v_mem, pg_temp._dr_del('org-documents', v_da), 'ok:1');
  v_k := 'C04 a member cannot write in another company''s folder, org-logos';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'insert into B', 'authenticated', v_mem, pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_b, 'png'), v_mem), '42501'),
    ('c', v_k, 'overwrite B''s real logos', 'authenticated', v_mem, pg_temp._dr_upd_dir('org-logos', v_b, v_lb), 'ok:0'),
    ('c', v_k, 'overwrite a logo of B', 'authenticated', v_mem, pg_temp._dr_upd('org-logos', v_lb), 'ok:0'),
    ('c', v_k, 'delete B''s real logos', 'authenticated', v_mem, pg_temp._dr_del_dir('org-logos', v_b, v_lb), 'ok:0'),
    ('c', v_k, 'delete a logo of B', 'authenticated', v_mem, pg_temp._dr_del('org-logos', v_lb), 'ok:0');
  v_k := 'C05 a member cannot write in another company''s folder, org-documents';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'upload into B', 'authenticated', v_mem, pg_temp._dr_ins('org-documents', pg_temp._dr_new(v_b, 'pdf'), v_mem), '42501'),
    ('c', v_k, 'delete a document of B', 'authenticated', v_mem, pg_temp._dr_del('org-documents', v_db), 'ok:0');
  v_k := 'C06 a member cannot move its own logo out of its company''s folder';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'into B''s folder', 'authenticated', v_mem, pg_temp._dr_mv('org-logos', v_la, pg_temp._dr_new(v_b, 'png')), '42501'),
    ('c', v_k, 'to the bucket root', 'authenticated', v_mem,
     pg_temp._dr_mv('org-logos', v_la, 'dryrun-' || gen_random_uuid()::text || '.png'), '42501');
  v_k := 'C07 a member uploads nothing outside a company folder (bucket root)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'logo', 'authenticated', v_mem, pg_temp._dr_ins('org-logos', 'dryrun-' || gen_random_uuid()::text || '.png', v_mem), '42501'),
    ('c', v_k, 'document', 'authenticated', v_mem, pg_temp._dr_ins('org-documents', 'dryrun-' || gen_random_uuid()::text || '.pdf', v_mem), '42501');
  v_k := 'C08 a signed-in account with no company writes nowhere';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'insert a logo into B', 'authenticated', v_str, pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_b, 'png'), v_str), '42501'),
    ('c', v_k, 'insert into a folder named after its own id', 'authenticated', v_str,
     pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_str::text, 'png'), v_str), '42501'),
    ('c', v_k, 'overwrite B''s real logos', 'authenticated', v_str, pg_temp._dr_upd_dir('org-logos', v_b, v_lb), 'ok:0'),
    ('c', v_k, 'delete a logo of B', 'authenticated', v_str, pg_temp._dr_del('org-logos', v_lb), 'ok:0'),
    ('c', v_k, 'upload a document into B', 'authenticated', v_str, pg_temp._dr_ins('org-documents', pg_temp._dr_new(v_b, 'pdf'), v_str), '42501');
  v_k := 'C09 a moderator writes in any company''s folder (API test: no screen does it today)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'insert a logo into B', 'authenticated', v_mod, pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_b, 'png'), v_mod), 'ok:1'),
    ('c', v_k, 'replace a logo of B', 'authenticated', v_mod, pg_temp._dr_upd('org-logos', v_lb), 'ok:1'),
    ('c', v_k, 'delete a logo of B', 'authenticated', v_mod, pg_temp._dr_del('org-logos', v_lb), 'ok:1'),
    ('c', v_k, 'upload a document into B', 'authenticated', v_mod, pg_temp._dr_ins('org-documents', pg_temp._dr_new(v_b, 'pdf'), v_mod), 'ok:1'),
    ('c', v_k, 'delete a document of B', 'authenticated', v_mod, pg_temp._dr_del('org-documents', v_db), 'ok:1');
  v_k := format('C10 the %s logo file(s) in folders of companies that no longer exist: staff only', coalesce(cardinality(v_orphan_names), 0));
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'member overwrites them', 'authenticated', v_mem, v_q_orphan_upd, 'ok:0'),
    ('c', v_k, 'member deletes them', 'authenticated', v_mem, v_q_orphan_del, 'ok:0'),
    ('c', v_k, 'no-company account overwrites them', 'authenticated', v_str, v_q_orphan_upd, 'ok:0'),
    ('c', v_k, 'member uploads into such a folder', 'authenticated', v_mem, pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_orphan, 'png'), v_mem), '42501'),
    ('c', v_k, 'moderator overwrites them', 'authenticated', v_mod, v_q_orphan_upd, 'ok:' || coalesce(cardinality(v_orphan_names), 0)::text),
    ('c', v_k, 'moderator uploads into such a folder', 'authenticated', v_mod, pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_orphan, 'png'), v_mod), 'ok:1'),
    ('c', v_k, 'moderator deletes a file there', 'authenticated', v_mod, pg_temp._dr_del('org-logos', v_lo), 'ok:1');
  v_k := 'C11 visitors (anon) write nothing';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'insert a logo into A', 'anon', null, pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_a, 'png'), null), '42501'),
    ('c', v_k, 'replace a logo of A', 'anon', null, pg_temp._dr_upd('org-logos', v_la), 'ok:0'),
    ('c', v_k, 'delete a logo of A', 'anon', null, pg_temp._dr_del('org-logos', v_la), 'ok:0'),
    ('c', v_k, 'upload a document into A', 'anon', null, pg_temp._dr_ins('org-documents', pg_temp._dr_new(v_a, 'pdf'), null), '42501'),
    ('c', v_k, 'delete a document of A', 'anon', null, pg_temp._dr_del('org-documents', v_da), 'ok:0');
  v_k := 'C12 public read of org-logos unchanged';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', v_k, 'anon lists the bucket', 'anon', null, 'select name from storage.objects where bucket_id = ''org-logos''', 'ok:' || v_n_logos::text),
    ('c', v_k, 'anon reads a real logo by name', 'anon', null, pg_temp._dr_sel('org-logos', v_real_logo), 'ok:1'),
    ('c', v_k, 'a member lists the bucket', 'authenticated', v_mem, 'select name from storage.objects where bucket_id = ''org-logos''', 'ok:' || v_n_logos::text);

  -- After the down
  v_k := 'E2 after the down, the old rule is back (an account with no company writes in B)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('e', v_k, 'insert a logo into B', 'authenticated', v_str, pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_b, 'png'), v_str), 'ok:1'),
    ('e', v_k, 'delete a logo of B', 'authenticated', v_str, pg_temp._dr_del('org-logos', v_lb), 'ok:1'),
    ('e', v_k, 'upload a document into B', 'authenticated', v_str, pg_temp._dr_ins('org-documents', pg_temp._dr_new(v_b, 'pdf'), v_str), 'ok:1');
  v_k := 'E3 after the down, a member still uploads in its own folder';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('e', v_k, 'logo', 'authenticated', v_mem, pg_temp._dr_ins('org-logos', pg_temp._dr_new(v_a, 'png'), v_mem), 'ok:1'),
    ('e', v_k, 'document', 'authenticated', v_mem, pg_temp._dr_ins('org-documents', pg_temp._dr_new(v_a, 'pdf'), v_mem), 'ok:1');
end
$a$;

do $b$
begin
  perform pg_temp._dr_run('b');
  perform pg_temp._dr_check('b');
end
$b$;

-- B. The migration, verbatim
-- Hole 3 of 3 of the go-live runbook (P2.4, Q8 = a), the most serious, 21 Oct 2026: any
-- signed-in account can overwrite or delete every logo, cover and gallery photo of the public
-- org-logos bucket (431 files) and upload into or delete from org-documents (21 files), in any
-- company's folder.
-- Down: supabase/migrations/down/20261021120200_org_storage_writes_own_folder.down.sql
-- Dry run: supabase/dryrun/20261021120200_org_storage_writes_own_folder.dryrun.sql
--
-- "Org members upload logos", "Org members update logos", "Org members delete logos",
-- "Org members upload documents" and "Org members delete documents" only check
-- auth.role() = 'authenticated'. They are replaced by folder-scoped policies, the rule that
-- org_documents_select_members already uses: staff (public.is_moderator()) or a row of
-- public.organization_members for auth.uid() whose organization_id::text is the first folder of
-- the path, (storage.foldername(name))[1].
--   INSERT: with check. UPDATE: using AND with check, so an object cannot be moved into another
--   company's folder. DELETE: using. For authenticated only: anon never wrote, the service role
--   bypasses RLS.
-- Every upload path already writes "<organization id>/...", the company coming from
-- organization_members (AuthContext): main OrganizationTab.tsx:178, 221, 266 (org-logos) and :315
-- (org-documents); refonte orgActions.ts:43, 79 (org-logos) and :161 (org-documents);
-- sm26-sync-media uses the service role. No client removes or moves a file in these buckets (a
-- removed photo or document only leaves the database) and no admin screen uploads here.
-- After this, staff only can rewrite: the 2 logo files in 2 folders of companies that no longer
-- exist, and 3 files (2 logos, 1 document) in 2 folders of companies since merged into another
-- (duplicate_of, no member left; their uploaders are members of the merged-into company).
-- Reads do not change.
-- Kept as they are: "Public read org logos" (storage upserts need it), org_documents_select_members
-- and every other storage.objects policy. No document UPDATE policy existed; none is added.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if (select count(*)
        from pg_policies p
        join (values
               ('Org members upload logos', 'INSERT', null,
                '((bucket_id = ''org-logos''::text) AND (auth.role() = ''authenticated''::text))'),
               ('Org members update logos', 'UPDATE',
                '((bucket_id = ''org-logos''::text) AND (auth.role() = ''authenticated''::text))', null),
               ('Org members delete logos', 'DELETE',
                '((bucket_id = ''org-logos''::text) AND (auth.role() = ''authenticated''::text))', null),
               ('Org members upload documents', 'INSERT', null,
                '((bucket_id = ''org-documents''::text) AND (auth.role() = ''authenticated''::text))'),
               ('Org members delete documents', 'DELETE',
                '((bucket_id = ''org-documents''::text) AND (auth.role() = ''authenticated''::text))', null)
             ) as e(n, c, q, w)
          on p.policyname = e.n and p.cmd = e.c and p.qual is not distinct from e.q and p.with_check is not distinct from e.w
       where p.schemaname = 'storage' and p.tablename = 'objects'
         and p.roles = '{public}'::name[] and p.permissive = 'PERMISSIVE') <> 5 then
    raise exception 'org storage writes: the five policies to replace are not all there as expected (applied already?)';
  end if;
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects'
                and p.policyname in ('org_logos_insert_members', 'org_logos_update_members', 'org_logos_delete_members',
                                     'org_documents_insert_members', 'org_documents_delete_members')) then
    raise exception 'org storage writes: a new policy name exists already';
  end if;
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'Public read org logos'
                    and p.cmd = 'SELECT' and p.qual = '(bucket_id = ''org-logos''::text)') then
    raise exception 'org storage writes: "Public read org logos" is missing or changed';
  end if;
  if to_regprocedure('public.is_moderator()') is null
     or not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.is_moderator()'))
     or not has_function_privilege('authenticated', 'public.is_moderator()', 'execute') then
    raise exception 'org storage writes: public.is_moderator() is missing, not SECURITY DEFINER or not callable by authenticated';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'organization_members'
         and (c.column_name, c.data_type) in (('user_id', 'uuid'), ('organization_id', 'uuid'))) <> 2 then
    raise exception 'org storage writes: organization_members.user_id / organization_id are missing or not uuid';
  end if;
end
$pre$;

drop policy "Org members upload logos" on storage.objects;
drop policy "Org members update logos" on storage.objects;
drop policy "Org members delete logos" on storage.objects;
drop policy "Org members upload documents" on storage.objects;
drop policy "Org members delete documents" on storage.objects;

create policy org_logos_insert_members on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

create policy org_logos_update_members on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-logos'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  )
  with check (
    bucket_id = 'org-logos'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

create policy org_logos_delete_members on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

create policy org_documents_insert_members on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-documents'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

create policy org_documents_delete_members on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-documents'
    and ((select public.is_moderator())
         or exists (select 1 from public.organization_members m
                     where m.user_id = (select auth.uid())
                       and m.organization_id::text = (storage.foldername(objects.name))[1]))
  );

do $post$
begin
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects'
                and p.policyname in ('Org members upload logos', 'Org members update logos', 'Org members delete logos',
                                     'Org members upload documents', 'Org members delete documents'))
     or (select count(*) from pg_policies p
          where p.schemaname = 'storage' and p.tablename = 'objects' and p.roles = '{authenticated}'::name[]
            and p.policyname in ('org_logos_insert_members', 'org_logos_update_members', 'org_logos_delete_members',
                                 'org_documents_insert_members', 'org_documents_delete_members')) <> 5 then
    raise exception 'org storage writes: the swap of the five policies is incomplete';
  end if;
end
$post$;

-- C. Checks after the migration
do $c$
begin
  insert into _dr_res (ok, label) values (
    not exists ((select s.n, s.cmd, s.r, s.permissive, s.q, s.w from _dr_pol s
                  where s.n not in ('Org members upload logos', 'Org members update logos', 'Org members delete logos',
                                    'Org members upload documents', 'Org members delete documents'))
                except
                (select p.policyname::text, p.cmd, p.roles::text, p.permissive, coalesce(p.qual, ''), coalesce(p.with_check, '')
                   from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'objects'
                    and p.policyname not in ('org_logos_insert_members', 'org_logos_update_members', 'org_logos_delete_members',
                                             'org_documents_insert_members', 'org_documents_delete_members')))
      and not exists ((select p.policyname::text, p.cmd, p.roles::text, p.permissive, coalesce(p.qual, ''), coalesce(p.with_check, '')
                         from pg_policies p
                        where p.schemaname = 'storage' and p.tablename = 'objects'
                          and p.policyname not in ('org_logos_insert_members', 'org_logos_update_members', 'org_logos_delete_members',
                                                   'org_documents_insert_members', 'org_documents_delete_members'))
                      except
                      (select s.n, s.cmd, s.r, s.permissive, s.q, s.w from _dr_pol s
                        where s.n not in ('Org members upload logos', 'Org members update logos', 'Org members delete logos',
                                          'Org members upload documents', 'Org members delete documents')))
      and (select count(*)
             from pg_policies p
             join (values ('org_logos_insert_members', 'INSERT', 'org-logos', false, true),
                          ('org_logos_update_members', 'UPDATE', 'org-logos', true, true),
                          ('org_logos_delete_members', 'DELETE', 'org-logos', true, false),
                          ('org_documents_insert_members', 'INSERT', 'org-documents', false, true),
                          ('org_documents_delete_members', 'DELETE', 'org-documents', true, false)) as e(n, c, b, hq, hw)
               on p.policyname = e.n and p.cmd = e.c
            where p.schemaname = 'storage' and p.tablename = 'objects'
              and p.roles = '{authenticated}'::name[] and p.permissive = 'PERMISSIVE'
              and (p.qual is not null) = e.hq and (p.with_check is not null) = e.hw
              and (p.qual is null or p.with_check is null or p.qual = p.with_check)
              and strpos(coalesce(p.qual, p.with_check), '''' || e.b || '''::text') > 0
              and strpos(coalesce(p.qual, p.with_check), 'is_moderator()') > 0
              and strpos(coalesce(p.qual, p.with_check), 'organization_members') > 0
              and strpos(coalesce(p.qual, p.with_check), 'auth.uid()') > 0
              and strpos(coalesce(p.qual, p.with_check), 'foldername(objects.name))[1]') > 0) = 5,
    format('C01 the five open write policies are replaced by five folder-scoped ones for authenticated (staff, or a member of the '
           || 'folder''s company; UPDATE checks the old and the new path); the other storage.objects policies are unchanged (%s before, %s after)',
           (select count(*) from _dr_pol),
           (select count(*) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects')));

  perform pg_temp._dr_run('c');
  perform pg_temp._dr_check('c');

  insert into _dr_res (ok, label) values (
    not exists ((select o.id, o.bucket_id, o.name, o.owner_id, md5(coalesce(o.metadata::text, '')), o.updated_at
                   from storage.objects o
                  where o.bucket_id in ('org-logos', 'org-documents')
                    and o.name not in (select f.t from _dr_fx f where f.k in ('la', 'lb', 'lo', 'da', 'db')))
                except
                (select s.id, s.bucket_id, s.name, s.owner_id, s.m, s.updated_at from _dr_obj s))
      and not exists ((select s.id, s.bucket_id, s.name, s.owner_id, s.m, s.updated_at from _dr_obj s)
                      except
                      (select o.id, o.bucket_id, o.name, o.owner_id, md5(coalesce(o.metadata::text, '')), o.updated_at
                         from storage.objects o
                        where o.bucket_id in ('org-logos', 'org-documents')))
      and (select count(*) from storage.objects o
            where (o.bucket_id, o.name) in (select case when f.k in ('da', 'db') then 'org-documents' else 'org-logos' end, f.t
                                              from _dr_fx f where f.k in ('la', 'lb', 'lo', 'da', 'db'))) = 5,
    format('C13 no try left a trace: the %s real file rows of both buckets are unchanged (name, owner, metadata, updated_at), '
           || 'the 5 test rows are still there', (select count(*) from _dr_obj)));
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021120200_org_storage_writes_own_folder.sql
-- Puts back the five open write policies (any signed-in account writes in any company's folder of
-- org-logos and org-documents), exactly as they were on 21 Oct 2026. Harmless for main and refonte
-- (they write in their own company's folder only), but it reopens the hole.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if (select count(*) from pg_policies p
       where p.schemaname = 'storage' and p.tablename = 'objects'
         and p.policyname in ('org_logos_insert_members', 'org_logos_update_members', 'org_logos_delete_members',
                              'org_documents_insert_members', 'org_documents_delete_members')) <> 5 then
    raise exception 'org storage writes down: the five folder-scoped policies are not all there';
  end if;
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects'
                and p.policyname in ('Org members upload logos', 'Org members update logos', 'Org members delete logos',
                                     'Org members upload documents', 'Org members delete documents')) then
    raise exception 'org storage writes down: an old policy exists already';
  end if;
end
$pre$;

drop policy org_logos_insert_members on storage.objects;
drop policy org_logos_update_members on storage.objects;
drop policy org_logos_delete_members on storage.objects;
drop policy org_documents_insert_members on storage.objects;
drop policy org_documents_delete_members on storage.objects;

create policy "Org members upload logos" on storage.objects
  for insert
  with check ((bucket_id = 'org-logos'::text) AND (auth.role() = 'authenticated'::text));
create policy "Org members update logos" on storage.objects
  for update
  using ((bucket_id = 'org-logos'::text) AND (auth.role() = 'authenticated'::text));
create policy "Org members delete logos" on storage.objects
  for delete
  using ((bucket_id = 'org-logos'::text) AND (auth.role() = 'authenticated'::text));
create policy "Org members upload documents" on storage.objects
  for insert
  with check ((bucket_id = 'org-documents'::text) AND (auth.role() = 'authenticated'::text));
create policy "Org members delete documents" on storage.objects
  for delete
  using ((bucket_id = 'org-documents'::text) AND (auth.role() = 'authenticated'::text));

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (
    not exists ((select s.n, s.cmd, s.r, s.permissive, s.q, s.w from _dr_pol s)
                except
                (select p.policyname::text, p.cmd, p.roles::text, p.permissive, coalesce(p.qual, ''), coalesce(p.with_check, '')
                   from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'))
      and not exists ((select p.policyname::text, p.cmd, p.roles::text, p.permissive, coalesce(p.qual, ''), coalesce(p.with_check, '')
                         from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects')
                      except
                      (select s.n, s.cmd, s.r, s.permissive, s.q, s.w from _dr_pol s)),
    format('E1 after the down, the %s storage.objects policies are exactly the snapshot again', (select count(*) from _dr_pol)));

  perform pg_temp._dr_run('e');
  perform pg_temp._dr_check('e');

  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_storage_writes_own_folder, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
