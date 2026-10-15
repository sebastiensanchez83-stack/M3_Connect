-- DRY RUN of supabase/migrations/held/directory_signed_in_only.sql (GO-LIVE ONLY) and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, AFTER 20261016090000_review_and_validation_orgs
-- is applied. A snapshot, the held file verbatim, then cases as anon and as signed-in accounts.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "6 PASS, 0 FAIL".
-- Down: supabase/dryrun/directory_signed_in_only.down.dryrun.sql ("1 PASS, 0 FAIL").

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot (read again after the migration, case S01: must be identical) ─
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'sm26', md5(concat_ws('|',
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_registration x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_role_assignment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_attendee x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_badge x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_payment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_invoice x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_networking_pass x)))
  union all select 'gl_guest', (select md5(coalesce(string_agg(g.id::text || g.token::text || g.status || coalesce(g.user_id::text, ''), ',' order by g.id), '')) from public.gl_guest g)
  union all select 'jobs', (select md5(coalesce(string_agg(j.id::text || j.status || coalesce(j.email_due_at::text, ''), ',' order by j.id), '')) from public.account_provision_job j)
  union all select 'orgs', (select md5(coalesce(string_agg(concat_ws('/', o.id, o.name, o.access_status, o.organization_type, o.owner_user_id, o.primary_domain, o.updated_at), ',' order by o.id), '')) from public.organizations o)
  union all select 'members', (select md5(coalesce(string_agg(m.id::text || m.user_id::text || m.role, ',' order by m.id), '')) from public.organization_members m)
  union all select 'profiles', (select md5(coalesce(string_agg(concat_ws('/', pr.user_id, pr.access_status, pr.onboarding_status, pr.persona, pr.updated_at, pr.email_proven_at), ',' order by pr.user_id), '')) from public.profiles pr)
  union all select 'invitations', (select md5(coalesce(string_agg(i.id::text || i.status, ',' order by i.id), '')) from public.organization_invitations i)
  union all select 'outbox', (select md5(coalesce(string_agg(n.id::text || coalesce(n.sent_at::text, ''), ',' order by n.id), '')) from public.notification_outbox n)
  union all select 'review_log', (select count(*)::text from public.review_log)
  union all select 'policies', (select md5(string_agg(format('%s|%s|%s|%s|%s', pl.tablename, pl.policyname, pl.roles, pl.qual, pl.with_check), ';' order by pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.schemaname = 'public')
  union all select 'cron', (select string_agg(j.jobname || '=' || j.schedule, ',' order by j.jobname) from cron.job j where j.jobname <> 'registration-cron-provision')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- ─── B. The migration, verbatim ─────────────────────────────────────────────────
-- HELD for the go-live of the redesign: NOT a normal migration. Spec §9 ("org_members_select_public,
-- marina_details_public_read -> authenticated, no longer anon") and §15 Phase 3; Victor, 6 Oct 2026:
-- "company cards public; people (teams) and marina details for signed-in only".
-- Held because the OLD live client (main) reads both SIGNED OUT, checked on 15 Oct 2026:
--   - src/pages/DirectoryPage.tsx counts each company's members with organization_members (the
--     /directory route is public);
--   - src/pages/OrganizationPublicPage.tsx (/organizations/:slug, public) reads organization_members
--     for the member count in the header and the "More for verified members" card, and
--     organization_marina_details for that card's "The marina's detailed profile" line.
--   With this file a signed-out visitor of main would see no member counts and a shorter card
--   (no error: the reads come back empty). The redesign reads them the same way today.
-- get_public_profiles is NOT here: neither client calls it signed out, so 20261016090000 already
-- revoked it from anon.
-- Before applying: the redesign's signed-out member counts read org_public_member_counts()
-- (20261016090000) instead of organization_members (contract §11.6); grep src for
-- "from('organization_members')" and "organization_marina_details" on pages reachable signed out.
-- Down: supabase/migrations/down/directory_signed_in_only.down.sql.
-- Dry run: supabase/dryrun/directory_signed_in_only.dryrun.sql.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regprocedure('public.org_public_member_counts(uuid[])') is null then
    raise exception 'directory_signed_in_only: apply 20261016090000_review_and_validation_orgs first (org_public_member_counts)';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
                  and p.policyname = 'org_members_select_public' and p.roles = '{anon}' and p.cmd = 'SELECT' and p.qual = 'true')
     and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
                  and p.policyname = 'org_members_select_public') then
    raise exception 'directory_signed_in_only: org_members_select_public changed; rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_marina_details'
                  and p.policyname = 'marina_details_public_read' and p.cmd = 'SELECT'
                  and p.qual like '%organizations o%' and p.qual like '%access_status = ''verified''%') then
    raise exception 'directory_signed_in_only: marina_details_public_read changed; rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
                  and p.policyname = 'org_members_select_auth' and p.roles = '{authenticated}' and p.qual = 'true') then
    raise exception 'directory_signed_in_only: org_members_select_auth is missing; signed-in visitors would lose the teams';
  end if;
end
$pre$;

-- Teams: signed-in visitors keep org_members_select_auth (any status); anon reads nothing.
drop policy if exists org_members_select_public on public.organization_members;
-- Marina details of validated marinas: signed-in visitors only (any status).
alter policy marina_details_public_read on public.organization_marina_details to authenticated;

-- ─── C. Test helpers (temporary, gone with the rollback) ───────────────────────
-- An account: the auth.users row (handle_new_user makes the profile), then status, persona, proof.
create function pg_temp.dr_user(p_id uuid, p_email text, p_meta jsonb, p_proven boolean, p_status text, p_persona text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', p_meta, now(), now(), now());
  update public.profiles
     set email_proven_at = case when p_proven then now() end,
         access_status = p_status::public.access_status_enum,
         persona = p_persona::public.persona_enum,
         onboarding_status = (case when p_status = 'verified' then 'completed' else 'submitted' end)::public.onboarding_status_enum
   where user_id = p_id;
end
$f$;
-- A company (and its owner member when given).
create function pg_temp.dr_org(p_id uuid, p_name text, p_status text, p_type text, p_owner uuid, p_site text)
returns void language plpgsql as $f$
begin
  insert into public.organizations (id, name, slug, access_status, onboarding_status, organization_type, owner_user_id, created_by_user_id, website)
  values (p_id, p_name, 'dryrun-' || p_id, p_status, case when p_status = 'verified' then 'completed' else 'submitted' end,
          p_type, p_owner, p_owner, p_site);
  if p_owner is not null then
    insert into public.organization_members (organization_id, user_id, role) values (p_id, p_owner, 'owner');
  end if;
end
$f$;

-- ─── D. Cases ───────────────────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
begin
  vars := jsonb_build_object('owner', gen_random_uuid(), 'p1', gen_random_uuid(), 'org_v', gen_random_uuid(), 'r8', r8,
    'e_owner', 'dryrun-owner-' || r8 || '@example.invalid', 'e_p1', 'dryrun-p1-' || r8 || '@example.invalid');
  s0 := $s$select pg_temp.dr_user({owner}, {e_owner}, '{}', true, 'verified', 'marina');
select pg_temp.dr_user({p1}, {e_p1}, '{}', false, 'pending', 'individual');
select pg_temp.dr_org({org_v}, 'Dryrun Marina ' || {r8}, 'verified', 'marina', {owner}, null);
insert into public.organization_marina_details (organization_id) values ({org_v})$s$;
  tests := jsonb_build_array(
    jsonb_build_object('id', 'H01', 'who', 'anon', 'expect', 'ret:0', 'label', 'signed out: no team members',
      'q', $q$select count(*)::text from public.organization_members where organization_id = {org_v}$q$),
    jsonb_build_object('id', 'H02', 'who', 'p1', 'expect', 'ret:1', 'label', 'signed in (any status): the team',
      'q', $q$select count(*)::text from public.organization_members where organization_id = {org_v}$q$),
    jsonb_build_object('id', 'H03', 'who', 'anon', 'expect', 'ret:0', 'label', 'signed out: no marina details',
      'q', $q$select count(*)::text from public.organization_marina_details where organization_id = {org_v}$q$),
    jsonb_build_object('id', 'H04', 'who', 'p1', 'expect', 'ret:1', 'label', 'signed in (any status): a validated marina''s details',
      'q', $q$select count(*)::text from public.organization_marina_details where organization_id = {org_v}$q$),
    jsonb_build_object('id', 'H05', 'who', 'anon', 'expect', 'ret:1', 'label', 'signed out: the member COUNT still comes from org_public_member_counts',
      'q', $q$select coalesce(string_agg(c.members::text, ','), 'none') from public.org_public_member_counts(array[{org_v}]::uuid[]) c$q$),
    jsonb_build_object('id', 'H06', 'who', 'postgres', 'bare', true, 'expect', 'ret:0/{authenticated}', 'label', 'the anon policy is gone; the marina policy is for authenticated',
      'q', $q$select (select count(*) from pg_policies where policyname = 'org_members_select_public')::text || '/' || (select roles::text from pg_policies where policyname = 'marina_details_public_read')$q$)
  );

  -- Runner: setup s0 + setup (postgres), q as the caller (an expected error is caught around q
  -- only, so chk still runs), chk (postgres), all rolled back. {x} = quoted vars.x; <x> = raw.
  for t in select * from jsonb_array_elements(tests) loop
    v_q := t ->> 'q'; v_setup := coalesce(t ->> 'setup', ''); v_chkq := coalesce(t ->> 'chk', ''); v_exp := t ->> 'expect';
    if not coalesce((t ->> 'bare')::boolean, false) then v_setup := s0 || ';' || v_setup; end if;
    for kv in select * from jsonb_each_text(vars) loop
      v_q := replace(v_q, '{' || kv.key || '}', quote_literal(kv.value));
      v_setup := replace(v_setup, '{' || kv.key || '}', quote_literal(kv.value));
      v_chkq := replace(v_chkq, '{' || kv.key || '}', quote_literal(kv.value));
      v_exp := replace(v_exp, '<' || kv.key || '>', kv.value);
    end loop;
    v_dml := lower(left(ltrim(v_q), 6)) in ('insert', 'update', 'delete');
    v_ret := null; v_n := null; v_err := null; v_state := null; v_chk := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      if btrim(v_setup, ' ;') <> '' then execute v_setup; end if;
      if t ->> 'who' = 'postgres' then
        null;
      elsif t ->> 'who' like 'jwt:%' then
        perform set_config('request.jwt.claims', jsonb_build_object('sub', vars ->> substr(t ->> 'who', 5), 'role', 'authenticated')::text, true);
      elsif t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', '{"role": "anon"}', true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
        set local role service_role;
      else
        v_uid := (vars ->> (t ->> 'who'))::uuid;
        perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated',
          'email', (select u.email from auth.users u where u.id = v_uid))::text, true);
        set local role authenticated;
      end if;
      begin
        if v_dml then
          execute v_q;
          get diagnostics v_n = row_count;
        else
          execute v_q into v_ret;
        end if;
      exception when others then
        if v_exp like 'err:%' or v_exp = 'rls' then v_err := sqlerrm; v_state := sqlstate; else raise; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if v_chkq <> '' then execute v_chkq into v_chk; end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := coalesce(v_err, sqlerrm); v_state := coalesce(v_state, sqlstate);
    end;
    v_pass := coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'rls' then v_state = '42501' or (v_err is null and v_dml and v_n = 0)
                when v_exp like 'err:%' then strpos(v_err, substr(v_exp, 5)) > 0
                when v_exp like 'ret:%' then v_err is null and v_ret is not distinct from substr(v_exp, 5)
              end, false)
              and (v_chkq = '' or v_chk is true);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s: %s | expect %s | %s%s',
      case when v_pass then 'PASS' else 'FAIL' end, t ->> 'id', t ->> 'who', t ->> 'label', v_exp,
      left(case when v_err is not null then format('error %s: %s', v_state, v_err)
                when v_dml then v_n || ' row(s) written'
                else 'returned ' || coalesce(v_ret, 'null') end, 300),
      case when v_chkq <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (directory_signed_in_only dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
