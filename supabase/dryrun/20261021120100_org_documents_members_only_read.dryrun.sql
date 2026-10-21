-- DRY RUN of supabase/migrations/20261021120100_org_documents_members_only_read.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- Fixtures are read at run time: a member (not staff) of a company that has document files, a
-- document of another company, a moderator, and a random signed-in id with no company. Every read
-- of org-documents is tried as its real role (set local role + request.jwt.claims) before the
-- migration, after it and after the down; each try runs in a sub-transaction that is always undone
-- (pg_temp._dr_try). Writes nothing. Prints counts and SQLSTATEs only. Independent of
-- 20261021120000 and 20261021120200 (applied or not).
-- It holds an exclusive lock on storage.objects from the migration to the end (a second or two).
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "13 PASS, 0 FAIL".

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
create temp table _dr_pol on commit drop as
  select p.policyname::text as n, p.cmd, p.roles::text as r, p.permissive, coalesce(p.qual, '') as q, coalesce(p.with_check, '') as w
    from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects';

do $a$
declare
  v_mem uuid;
  v_mem_org uuid;
  v_mod uuid;
  v_str uuid := gen_random_uuid();
  v_n_docs bigint;
  v_mem_own bigint;
  v_n_logos bigint;
  v_doc_own text;
  v_doc_other text;
  v_list text := 'select name from storage.objects where bucket_id = ''org-documents''';
  v_k text;
begin
  select m.user_id, m.organization_id into v_mem, v_mem_org
    from public.organization_members m
    join auth.users u on u.id = m.user_id
   where exists (select 1 from storage.objects ob
                  where ob.bucket_id = 'org-documents' and (storage.foldername(ob.name))[1] = m.organization_id::text)
     and not exists (select 1 from public.profiles p
                      where p.user_id = m.user_id and p.access_status = 'verified'
                        and p.persona::text in ('admin', 'moderator'))
   order by m.organization_id, m.user_id
   limit 1;
  select p.user_id into v_mod
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where p.access_status = 'verified' and p.persona::text in ('admin', 'moderator')
   order by p.user_id
   limit 1;
  select count(*) into v_n_docs from storage.objects ob where ob.bucket_id = 'org-documents';
  select count(*) into v_n_logos from storage.objects ob where ob.bucket_id = 'org-logos';
  select count(*) into v_mem_own
    from storage.objects ob
   where ob.bucket_id = 'org-documents'
     and exists (select 1 from public.organization_members m
                  where m.user_id = v_mem and m.organization_id::text = (storage.foldername(ob.name))[1]);
  select min(ob.name) into v_doc_own
    from storage.objects ob where ob.bucket_id = 'org-documents' and (storage.foldername(ob.name))[1] = v_mem_org::text;
  select min(ob.name) into v_doc_other
    from storage.objects ob
   where ob.bucket_id = 'org-documents'
     and not exists (select 1 from public.organization_members m
                      where m.user_id = v_mem and m.organization_id::text = (storage.foldername(ob.name))[1]);
  if v_mem is null or v_mod is null or v_doc_own is null or v_doc_other is null then
    raise exception 'DRYRUN 0 PASS, 1 FAIL (fixtures missing: member with documents %, moderator %, document of another company %)',
      v_mem is not null, v_mod is not null, v_doc_other is not null;
  end if;
  insert into _dr_res (ok, label) values (v_mem_own >= 1 and v_mem_own < v_n_docs,
    format('F0 fixtures: a member (not staff) whose companies hold %s of the %s document file(s); a document of another company; a moderator',
           v_mem_own, v_n_docs));

  -- Before the migration: the hole
  v_k := 'B1 today any signed-in account lists and reads every document file (the hole)';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('b', v_k, 'member lists the bucket', 'authenticated', v_mem, v_list, 'ok:' || v_n_docs::text),
    ('b', v_k, 'member reads another company''s document', 'authenticated', v_mem,
     format('select name from storage.objects where bucket_id = %L and name = %L', 'org-documents', v_doc_other), 'ok:1'),
    ('b', v_k, 'no-company account lists the bucket', 'authenticated', v_str, v_list, 'ok:' || v_n_docs::text);

  -- After the migration
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('c', 'C02 a member lists its own companies'' files only', 'member', 'authenticated', v_mem, v_list, 'ok:' || v_mem_own::text),
    ('c', 'C03 a member no longer reads another company''s document (list or signed link)', 'member', 'authenticated', v_mem,
     format('select name from storage.objects where bucket_id = %L and name = %L', 'org-documents', v_doc_other), 'ok:0'),
    ('c', 'C04 a member still reads its own company''s document (signed link after upload: main OrganizationTab.tsx:319, refonte orgActions.ts:165)',
     'member', 'authenticated', v_mem,
     format('select name from storage.objects where bucket_id = %L and name = %L', 'org-documents', v_doc_own), 'ok:1'),
    ('c', 'C05 a signed-in account with no company lists nothing', 'no-company account', 'authenticated', v_str, v_list, 'ok:0'),
    ('c', 'C06 a moderator still lists every file', 'moderator', 'authenticated', v_mod, v_list, 'ok:' || v_n_docs::text),
    ('c', 'C07 visitors (anon) list nothing', 'anon', 'anon', null, v_list, 'ok:0'),
    ('c', 'C08 the stored one-year links (organization_documents) stay members and staff only', 'no-company account',
     'authenticated', v_str, 'select file_url from public.organization_documents', 'ok:0'),
    ('c', 'C09 public read of org-logos unchanged', 'anon lists org-logos', 'anon', null,
     'select name from storage.objects where bucket_id = ''org-logos''', 'ok:' || v_n_logos::text);

  -- After the down
  v_k := 'E2 after the down, every signed-in account lists every document file again';
  insert into _dr_case (phase, k, label, role, sub, q, want) values
    ('e', v_k, 'member', 'authenticated', v_mem, v_list, 'ok:' || v_n_docs::text),
    ('e', v_k, 'no-company account', 'authenticated', v_str, v_list, 'ok:' || v_n_docs::text);
end
$a$;

do $b$
begin
  perform pg_temp._dr_run('b');
  perform pg_temp._dr_check('b');
end
$b$;

-- B. The migration, verbatim
-- Hole 2 of 3 of the go-live runbook (P2.4, Q8 = a), 21 Oct 2026: any signed-in account lists
-- and reads every file of the private org-documents bucket (21 files, 19 listed documents).
-- Down: supabase/migrations/down/20261021120100_org_documents_members_only_read.down.sql
-- Dry run: supabase/dryrun/20261021120100_org_documents_members_only_read.dryrun.sql
--
-- "Org members read documents" only checks auth.role() = 'authenticated'. It is dropped. The
-- strict policy org_documents_select_members stays: staff (is_moderator()) or a member of the
-- company whose id is the first folder of the path.
-- Clients (main 2a332cf8, refonte 02559e58): the only read of the bucket is createSignedUrl right
-- after the member's own upload (main OrganizationTab.tsx:319, refonte orgActions.ts:165), in its
-- own company's folder; the list shows the one-year signed link stored in organization_documents
-- (members and staff only), which needs no storage policy. Nothing else reads this bucket.
-- Writes are hole 3 (20261021120200). No other policy changes.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'objects'
                    and p.policyname = 'Org members read documents' and p.cmd = 'SELECT'
                    and p.roles = '{public}'::name[] and p.permissive = 'PERMISSIVE'
                    and p.qual = '((bucket_id = ''org-documents''::text) AND (auth.role() = ''authenticated''::text))'
                    and p.with_check is null) then
    raise exception 'org-documents: the policy "Org members read documents" is missing or changed (applied already?)';
  end if;
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'storage' and p.tablename = 'objects'
                    and p.policyname = 'org_documents_select_members' and p.cmd = 'SELECT'
                    and p.roles = '{authenticated}'::name[] and p.permissive = 'PERMISSIVE'
                    and strpos(p.qual, 'org-documents') > 0 and strpos(p.qual, 'is_moderator()') > 0
                    and strpos(p.qual, 'organization_members') > 0 and strpos(p.qual, 'foldername(objects.name))[1]') > 0) then
    raise exception 'org-documents: the member policy org_documents_select_members is missing or changed';
  end if;
  if (select b.public from storage.buckets b where b.id = 'org-documents') is distinct from false then
    raise exception 'org-documents: the bucket is missing or public';
  end if;
end
$pre$;

drop policy "Org members read documents" on storage.objects;

-- C. Checks after the migration
do $c$
begin
  insert into _dr_res (ok, label) values (
    not exists (select 1 from pg_policies p
                 where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'Org members read documents')
      and not exists ((select s.n, s.cmd, s.r, s.permissive, s.q, s.w from _dr_pol s where s.n <> 'Org members read documents')
                      except
                      (select p.policyname::text, p.cmd, p.roles::text, p.permissive, coalesce(p.qual, ''), coalesce(p.with_check, '')
                         from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'))
      and not exists ((select p.policyname::text, p.cmd, p.roles::text, p.permissive, coalesce(p.qual, ''), coalesce(p.with_check, '')
                         from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects')
                      except
                      (select s.n, s.cmd, s.r, s.permissive, s.q, s.w from _dr_pol s where s.n <> 'Org members read documents')),
    format('C01 "Org members read documents" dropped; the %s other storage.objects policies (org_documents_select_members among them) unchanged',
           (select count(*) - 1 from _dr_pol)));

  perform pg_temp._dr_run('c');
  perform pg_temp._dr_check('c');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021120100_org_documents_members_only_read.sql
-- Puts back the open read policy: every signed-in account lists and reads every file of
-- org-documents again. Harmless for main and refonte (they read their own folder only).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'Org members read documents') then
    raise exception 'org-documents down: "Org members read documents" exists already (nothing to undo)';
  end if;
end
$pre$;

create policy "Org members read documents" on storage.objects
  for select
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
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (org_documents_members_only_read, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
