-- DRY RUN of supabase/migrations/20261021161000_org_admin_note.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- Fixtures are read at run time: two verified admins (staff), a verified person who is not staff
-- and whose address is confirmed and proven, two verified companies they are not a member of.
-- Every read and write is tried as its real role (set local role + request.jwt.claims); each try
-- runs in a sub-transaction that is always undone (pg_temp._dr_try). The join-request answers
-- (E1-E3) run as the admin on two fixture requests created here. Prints counts, statuses and
-- SQLSTATEs only, never names or addresses. Independent of every other pending file.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "DRYRUN 14 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Helpers, fixtures, the "before" figures
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_fx (k text primary key, u uuid, t text) on commit drop;

-- One try: runs p_sql as p_role with auth.uid() = p_sub; returns 'ok:<rows>' or the SQLSTATE.
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

-- One result line: ok when every got equals its want.
create function pg_temp._dr_line(p_label text, p_got text[], p_want text[]) returns void
language plpgsql as $f$
declare
  v_ok boolean := array_length(p_got, 1) = array_length(p_want, 1);
  v_txt text := '';
  i int;
begin
  for i in 1 .. coalesce(array_length(p_got, 1), 0) loop
    v_ok := v_ok and p_got[i] is not distinct from p_want[i];
    v_txt := v_txt || case when i > 1 then ', ' else '' end || coalesce(p_got[i], 'null')
             || case when p_got[i] is distinct from p_want[i] then ' (want ' || coalesce(p_want[i], 'null') || ')' else '' end;
  end loop;
  insert into pg_temp._dr_res (ok, label) values (coalesce(v_ok, false), p_label || ': ' || v_txt);
end
$f$;

do $a$
declare
  v_adm uuid;
  v_adm2 uuid;
  v_mem uuid;
  v_mem_email text;
  v_org uuid;
  v_org2 uuid;
begin
  select p.user_id into v_adm from public.profiles p join auth.users u on u.id = p.user_id
   where p.persona = 'admin' and p.access_status = 'verified' order by p.user_id limit 1;
  select p.user_id into v_adm2 from public.profiles p join auth.users u on u.id = p.user_id
   where p.persona = 'admin' and p.access_status = 'verified' and p.user_id <> v_adm order by p.user_id limit 1;
  select p.user_id, u.email into v_mem, v_mem_email
    from public.profiles p join auth.users u on u.id = p.user_id
   where p.persona::text not in ('admin', 'moderator') and p.access_status = 'verified'
     and p.email_proven_at is not null and u.email_confirmed_at is not null and lower(p.email) = lower(u.email)
     and not exists (select 1 from public.organization_invitations oi
                      where lower(oi.email) = lower(u.email) and oi.status = 'join_requested')
   order by p.user_id limit 1;
  select o.id into v_org from public.organizations o
   where o.access_status = 'verified'
     and not exists (select 1 from public.organization_members m where m.organization_id = o.id and m.user_id = v_mem)
   order by o.id limit 1;
  select o.id into v_org2 from public.organizations o
   where o.access_status = 'verified' and o.id <> v_org
     and not exists (select 1 from public.organization_members m where m.organization_id = o.id and m.user_id = v_mem)
   order by o.id limit 1;
  if v_adm is null or v_adm2 is null or v_mem is null or v_org is null or v_org2 is null then
    raise exception 'DRYRUN 0 PASS, 1 FAIL (fixtures missing: admin %, second admin %, proven person %, companies % %)',
      v_adm is not null, v_adm2 is not null, v_mem is not null, v_org is not null, v_org2 is not null;
  end if;
  insert into _dr_fx (k, u, t) values
    ('adm', v_adm, null), ('adm2', v_adm2, null), ('mem', v_mem, v_mem_email), ('org', v_org, null), ('org2', v_org2, null);
  -- Before: what the person and the admin read of the company history today.
  insert into _dr_fx (k, t) values
    ('audit_mem_before', pg_temp._dr_try('authenticated', v_mem, 'select id from public.organization_audit_log')),
    ('audit_total', 'ok:' || (select count(*) from public.organization_audit_log)::text),
    ('fn_before', coalesce(to_regprocedure('public.admin_decide_join_request(uuid,boolean,text)')::text, 'none'));
  insert into _dr_res (ok, label) values (true, format(
    'F0 fixtures: 2 admins, a proven person (not staff), 2 verified companies they are not in; history rows %s, the person reads %s today',
    (select t from _dr_fx where k = 'audit_total'), (select t from _dr_fx where k = 'audit_mem_before')));
end
$a$;

-- B. The migration, verbatim
-- Admin redesign, lane "members" (21 Oct 2026): what the new company page needs from the database.
-- NOT APPLIED. Apply with Victor's OK, after the dry run
-- supabase/dryrun/20261021161000_org_admin_note.dryrun.sql (it runs this file, cases, then its
-- down, in one rolled-back transaction). Down: supabase/migrations/down/20261021161000_org_admin_note.down.sql.
-- Independent of every other pending file; any order. The redesign's screens cope with it missing
-- (the Notes tab says "not set up yet", Accept / Refuse of a join request says so too).
--
-- ADDITIVE ONLY, harmless for the live site (main never names these objects):
--  1. public.org_admin_note: M3's internal notes on a company (organization_id) or on a person who
--     has no company (user_id); exactly one of the two. Never shown to members. Staff only:
--     is_moderator() (verified admins and moderators), the same test as review_log's reads.
--     Append-only: no update; a note is deleted by its author only. Grants explicit: PUBLIC and
--     anon get nothing; authenticated gets SELECT, DELETE and INSERT of organization_id, user_id,
--     author_id and body only (id and created_at are always set by the database, so a note cannot
--     be backdated); the policies decide the rows. service_role everything.
--  2. Policy org_audit_staff_read on public.organization_audit_log: staff read a company's history.
--     Today only the company owner reads it (org_audit_select). One more SELECT policy, nothing else.
--  3. public.admin_decide_join_request(p_invitation_id, p_approve, p_note): M3 answers a join
--     request on the owner's behalf (company page, Members tab). Verified admins only (as
--     admin_remove_org_member). Approving follows approve_join_request in its go-live version
--     (held/signup_identity_golive.sql): a request the person filed themself, an address that is
--     confirmed AND proven; a suspended account stays suspended. Refusing = reject_join_request.
--     Each answer writes one review_log row (subject_type 'join'). EXECUTE: authenticated only.
--     SECURITY DEFINER with search_path = '' and every table qualified (house rule).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.org_admin_note') is not null then
    raise exception 'org_admin_note: the table exists already (applied?)';
  end if;
  if to_regprocedure('public.admin_decide_join_request(uuid,boolean,text)') is not null then
    raise exception 'org_admin_note: admin_decide_join_request exists already (applied?)';
  end if;
  if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_audit_log'
              and p.policyname = 'org_audit_staff_read') then
    raise exception 'org_admin_note: policy org_audit_staff_read exists already (applied?)';
  end if;
  if to_regprocedure('public.is_moderator()') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'org_admin_note: is_moderator() or is_admin() is missing';
  end if;
end
$pre$;

-- 1. Internal notes
create table public.org_admin_note (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint org_admin_note_one_subject check ((organization_id is null) <> (user_id is null)),
  constraint org_admin_note_body_len check (char_length(btrim(body)) between 1 and 4000)
);
comment on table public.org_admin_note is
  'M3 internal notes on a company (organization_id) or a person without a company (user_id). Staff only, never shown to members.';

create index org_admin_note_org_idx on public.org_admin_note (organization_id, created_at desc) where organization_id is not null;
create index org_admin_note_user_idx on public.org_admin_note (user_id, created_at desc) where user_id is not null;

alter table public.org_admin_note enable row level security;

revoke all on table public.org_admin_note from public, anon, authenticated;
grant select, delete on table public.org_admin_note to authenticated;
grant insert (organization_id, user_id, author_id, body) on table public.org_admin_note to authenticated;
grant all on table public.org_admin_note to service_role;

create policy org_admin_note_staff_read on public.org_admin_note
  for select to authenticated
  using ((select public.is_moderator()));

create policy org_admin_note_staff_write on public.org_admin_note
  for insert to authenticated
  with check ((select public.is_moderator()) and author_id = (select auth.uid()));

create policy org_admin_note_author_delete on public.org_admin_note
  for delete to authenticated
  using ((select public.is_moderator()) and author_id = (select auth.uid()));

-- 2. Staff read the company history
create policy org_audit_staff_read on public.organization_audit_log
  for select to authenticated
  using ((select public.is_moderator()));

-- 3. M3 answers a join request
create function public.admin_decide_join_request(p_invitation_id uuid, p_approve boolean, p_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $function$
declare
  v_inv          record;
  v_requester_id uuid;
  v_org_verified boolean;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Say whether to accept or refuse' using errcode = '22023';
  end if;

  select oi.id, oi.organization_id, oi.email, oi.status, oi.invited_by_user_id
    into v_inv
    from public.organization_invitations oi
   where oi.id = p_invitation_id
     for update;
  if not found then raise exception 'Join request not found' using errcode = 'P0002'; end if;
  if v_inv.status <> 'join_requested' then
    raise exception 'This request was already answered (now: %)', v_inv.status using errcode = '22023';
  end if;
  -- A row an owner wrote is an invitation: only the invited person can accept it.
  if v_inv.invited_by_user_id is not null then
    raise exception 'This is an invitation, not a join request: only the invited person can accept it' using errcode = '22023';
  end if;

  if not p_approve then
    update public.organization_invitations set status = 'rejected', updated_at = now() where id = p_invitation_id;
    insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
    values ('join', p_invitation_id, 'join_request_declined', nullif(btrim(coalesce(p_note, '')), ''),
            jsonb_build_object('source', 'admin_company_page', 'organization_id', v_inv.organization_id), auth.uid());
    return jsonb_build_object('ok', true, 'decision', 'refused', 'organization_id', v_inv.organization_id);
  end if;

  -- Only an account whose address is confirmed AND proven can be the requester.
  select u.id into v_requester_id
    from auth.users u
   where lower(u.email) = lower(v_inv.email) and u.email_confirmed_at is not null;
  if v_requester_id is null then
    raise exception 'No confirmed account uses this address' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles p
                  where p.user_id = v_requester_id and p.email_proven_at is not null
                    and lower(p.email) = lower(v_inv.email)) then
    raise exception 'This person has not confirmed their email address yet. Ask them to use the link in the banner on their dashboard, then accept again.'
      using errcode = '22023';
  end if;

  update public.organization_invitations set status = 'accepted', updated_at = now() where id = p_invitation_id;
  insert into public.organization_members (user_id, organization_id, role)
  values (v_requester_id, v_inv.organization_id, 'collaborator')
  on conflict do nothing;

  select (o.access_status = 'verified') into v_org_verified from public.organizations o where o.id = v_inv.organization_id;
  if v_org_verified then
    update public.profiles set access_status = 'verified', onboarding_status = 'completed', updated_at = now()
     where user_id = v_requester_id and access_status <> 'suspended';
  else
    update public.profiles set onboarding_status = 'submitted', updated_at = now()
     where user_id = v_requester_id and access_status <> 'verified';
  end if;

  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('join', p_invitation_id, 'join_request_approved', nullif(btrim(coalesce(p_note, '')), ''),
          jsonb_build_object('source', 'admin_company_page', 'organization_id', v_inv.organization_id, 'user_id', v_requester_id),
          auth.uid());
  return jsonb_build_object('ok', true, 'decision', 'accepted', 'organization_id', v_inv.organization_id, 'user_id', v_requester_id);
end
$function$;

revoke all on function public.admin_decide_join_request(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_join_request(uuid, boolean, text) to authenticated;

-- C. After the migration: notes, history, join-request answers
do $c$
declare
  v_adm uuid := (select u from _dr_fx where k = 'adm');
  v_adm2 uuid := (select u from _dr_fx where k = 'adm2');
  v_mem uuid := (select u from _dr_fx where k = 'mem');
  v_org uuid := (select u from _dr_fx where k = 'org');
  v_ins_org text;
  v_ins_user text;
  v_note text;
begin
  v_ins_org := format('insert into public.org_admin_note (organization_id, body) values (%L, %L)', v_org, 'dry run note');
  v_ins_user := format('insert into public.org_admin_note (user_id, body) values (%L, %L)', v_mem, 'dry run note');
  v_note := 'select id from public.org_admin_note';
  -- A note that exists for the reads and deletes below (written as the table owner, signed by the admin).
  insert into public.org_admin_note (organization_id, body, author_id) values (v_org, 'dry run fixture', v_adm);

  perform pg_temp._dr_line('C01 staff write a note on a company and on a person without a company',
    array[pg_temp._dr_try('authenticated', v_adm, v_ins_org), pg_temp._dr_try('authenticated', v_adm, v_ins_user)],
    array['ok:1', 'ok:1']);
  perform pg_temp._dr_line('C02 a note has exactly one subject (both, neither refused)',
    array[pg_temp._dr_try('authenticated', v_adm, format('insert into public.org_admin_note (organization_id, user_id, body) values (%L, %L, %L)', v_org, v_mem, 'x')),
          pg_temp._dr_try('authenticated', v_adm, format('insert into public.org_admin_note (body) values (%L)', 'x'))],
    array['23514', '23514']);
  perform pg_temp._dr_line('C03 a note cannot be signed with another author, nor backdated, nor given its own id',
    array[pg_temp._dr_try('authenticated', v_adm, format('insert into public.org_admin_note (organization_id, body, author_id) values (%L, %L, %L)', v_org, 'x', v_adm2)),
          pg_temp._dr_try('authenticated', v_adm, format('insert into public.org_admin_note (organization_id, body, created_at) values (%L, %L, %L)', v_org, 'x', '2020-01-01')),
          pg_temp._dr_try('authenticated', v_adm, format('insert into public.org_admin_note (id, organization_id, body) values (%L, %L, %L)', gen_random_uuid(), v_org, 'x'))],
    array['42501', '42501', '42501']);
  perform pg_temp._dr_line('C04 a member (not staff) reads no note, writes none, deletes none',
    array[pg_temp._dr_try('authenticated', v_mem, v_note), pg_temp._dr_try('authenticated', v_mem, v_ins_org),
          pg_temp._dr_try('authenticated', v_mem, 'delete from public.org_admin_note')],
    array['ok:0', '42501', 'ok:0']);
  perform pg_temp._dr_line('C05 visitors (anon) have no access to the notes',
    array[pg_temp._dr_try('anon', null, v_note)],
    array['42501']);
  perform pg_temp._dr_line('C06 staff read the notes; nobody edits a note (no update grant)',
    array[pg_temp._dr_try('authenticated', v_adm, v_note),
          pg_temp._dr_try('authenticated', v_adm, format('update public.org_admin_note set body = %L', 'changed'))],
    array['ok:1', '42501']);
  perform pg_temp._dr_line('C07 only its author deletes a note (another admin deletes nothing)',
    array[pg_temp._dr_try('authenticated', v_adm2, 'delete from public.org_admin_note'),
          pg_temp._dr_try('authenticated', v_adm, 'delete from public.org_admin_note')],
    array['ok:0', 'ok:1']);
  perform pg_temp._dr_line('C08 staff read every company''s history; a member reads what they read before',
    array[pg_temp._dr_try('authenticated', v_adm, 'select id from public.organization_audit_log'),
          pg_temp._dr_try('authenticated', v_mem, 'select id from public.organization_audit_log')],
    array[(select t from _dr_fx where k = 'audit_total'), (select t from _dr_fx where k = 'audit_mem_before')]);
  -- Visitors: the grants themselves (a call as anon would raise 42501 from "Admin only" even
  -- without the revoke, so it proves nothing). anon has no EXECUTE, PUBLIC is not in the ACL,
  -- anon holds no privilege at all on the notes table.
  perform pg_temp._dr_line('C09 admin_decide_join_request refused to a member; visitors and PUBLIC hold no grant on the function or the notes',
    array[pg_temp._dr_try('authenticated', v_mem, format('select public.admin_decide_join_request(%L, true, null)', gen_random_uuid())),
          has_function_privilege('anon', 'public.admin_decide_join_request(uuid,boolean,text)', 'execute')::text,
          exists(select 1 from pg_proc p, aclexplode(p.proacl) a
                  where p.oid = to_regprocedure('public.admin_decide_join_request(uuid,boolean,text)') and a.grantee = 0)::text,
          has_table_privilege('anon', 'public.org_admin_note', 'select,insert,update,delete,truncate,references,trigger')::text],
    array['42501', 'false', 'false', 'false']);
end
$c$;

-- E. The admin answers two fixture join requests (and two it must refuse)
do $e$
declare
  v_adm uuid := (select u from _dr_fx where k = 'adm');
  v_adm2 uuid := (select u from _dr_fx where k = 'adm2');
  v_mem uuid := (select u from _dr_fx where k = 'mem');
  v_mem_email text := (select t from _dr_fx where k = 'mem');
  v_org uuid := (select u from _dr_fx where k = 'org');
  v_org2 uuid := (select u from _dr_fx where k = 'org2');
  v_inv1 uuid;
  v_inv2 uuid;
  v_inv3 uuid;
  v_r1 jsonb;
  v_r2 jsonb;
begin
  insert into public.organization_invitations (organization_id, email, status) values (v_org, v_mem_email, 'join_requested') returning id into v_inv1;
  insert into public.organization_invitations (organization_id, email, status) values (v_org2, v_mem_email, 'join_requested') returning id into v_inv2;
  insert into public.organization_invitations (organization_id, email, status, invited_by_user_id)
  values (v_org2, 'dryrun-invitee@example.invalid', 'join_requested', v_adm2) returning id into v_inv3;

  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_r1 := public.admin_decide_join_request(v_inv1, true, 'dry run');
  v_r2 := public.admin_decide_join_request(v_inv2, false, null);
  execute 'reset role';

  perform pg_temp._dr_line('E1 accept: request accepted, the person joined as a team member, one review_log row',
    array[v_r1 ->> 'decision',
          (select status from public.organization_invitations where id = v_inv1),
          (select role from public.organization_members where organization_id = v_org and user_id = v_mem),
          (select count(*)::text from public.review_log where subject_type = 'join' and subject_id = v_inv1
              and action = 'join_request_approved' and actor_id = v_adm)],
    array['accepted', 'accepted', 'collaborator', '1']);
  perform pg_temp._dr_line('E2 refuse: request refused, nobody joined, one review_log row',
    array[v_r2 ->> 'decision',
          (select status from public.organization_invitations where id = v_inv2),
          (select count(*)::text from public.organization_members where organization_id = v_org2 and user_id = v_mem),
          (select count(*)::text from public.review_log where subject_type = 'join' and subject_id = v_inv2
              and action = 'join_request_declined' and actor_id = v_adm)],
    array['refused', 'rejected', '0', '1']);
  perform pg_temp._dr_line('E3 a request already answered, and an invitation an owner wrote, are refused',
    array[pg_temp._dr_try('authenticated', v_adm, format('select public.admin_decide_join_request(%L, true, null)', v_inv1)),
          pg_temp._dr_try('authenticated', v_adm, format('select public.admin_decide_join_request(%L, true, null)', v_inv3))],
    array['22023', '22023']);
end
$e$;

-- D. The down, verbatim
-- DOWN of supabase/migrations/20261021161000_org_admin_note.sql.
-- Removes the three objects it added; nothing else existed before. The notes written in the
-- meantime are lost with the table (export them first if they matter). Join requests answered
-- through admin_decide_join_request stay answered (their review_log rows stay too).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.admin_decide_join_request(uuid, boolean, text);
drop policy if exists org_audit_staff_read on public.organization_audit_log;
drop table if exists public.org_admin_note;

-- E. After the down, and the verdict
do $z$
declare
  v_mem uuid := (select u from _dr_fx where k = 'mem');
  v_pass int;
  v_fail int;
  v_txt text;
begin
  perform pg_temp._dr_line('D1 after the down: no notes table, no function, no staff history policy; a member reads what they read before',
    array[coalesce(to_regclass('public.org_admin_note')::text, 'none'),
          coalesce(to_regprocedure('public.admin_decide_join_request(uuid,boolean,text)')::text, 'none'),
          (select count(*)::text from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_audit_log' and p.policyname = 'org_audit_staff_read'),
          pg_temp._dr_try('authenticated', v_mem, 'select id from public.organization_audit_log')],
    array['none', (select t from _dr_fx where k = 'fn_before'), '0', (select t from _dr_fx where k = 'audit_mem_before')]);

  select count(*) filter (where ok), count(*) filter (where not ok),
         string_agg(case when ok then 'PASS ' else 'FAIL ' end || label, E'\n' order by n)
    into v_pass, v_fail, v_txt
    from pg_temp._dr_res;
  raise exception 'DRYRUN % PASS, % FAIL%', v_pass, v_fail, E'\n' || v_txt;
end
$z$;
