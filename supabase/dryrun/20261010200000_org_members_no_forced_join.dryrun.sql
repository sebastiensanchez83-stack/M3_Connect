-- DRY RUN of supabase/migrations/20261010200000_org_members_no_forced_join.sql
-- (and of its down script). NOT A MIGRATION: never apply it.
--
-- Run it as ONE query text (one implicit transaction), in ONE execute_sql call. The last
-- statement ends with RAISE EXCEPTION 'DRYRUN ...': the report is the error message, and
-- everything (policies, function, test companies, memberships, invitations, profile
-- changes) rolls back.
-- Tripwire: if the report starts with "FAIL T0 before-snapshot missing", the statements
-- did NOT run in one transaction and the migration AND the down script may have been
-- committed: check pg_policies and md5(approve_join_request) at once.
--
-- Order:
--   0. before-snapshot (fingerprints, test people);
--   1. the migration, verbatim from its precondition to the end;
--   2. checks on the migrated state (T0-T12);
--   3. the down script, verbatim from its precondition to the end;
--   4. checks after the down script (T13-T14) and the report.
-- Each test T2-T12 and T14 builds its own test companies, then raises 'DRYRUN_UNDO' inside
-- its own block: nothing it wrote reaches the next test (plpgsql variables, which carry
-- the report, are not rolled back).
-- People are picked at run time, read-only: six confirmed accounts that are not staff, are
-- in no company, own or created none, have no invitation and no failed claim attempt
-- (oldest first), and one verified admin. No id or address is written in this file.
--
-- Expected report: every line PASS, the last one "SUMMARY 66 PASS, 0 FAIL".

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Before
-- ════════════════════════════════════════════════════════════════════════════
do $before$
declare
  pick uuid[];
  staff uuid;
begin
  perform set_config('smc_dryrun.pol_all_before', (
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, cmd, roles, qual, with_check), ';' order by tablename, policyname), ''))
      from pg_policies
     where schemaname = 'public' and tablename in ('organization_members', 'organization_invitations')), true);
  perform set_config('smc_dryrun.pol_others_before', (
    select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, cmd, roles, qual, with_check), ';' order by tablename, policyname), ''))
      from pg_policies
     where schemaname = 'public' and tablename in ('organization_members', 'organization_invitations')
       and policyname not in ('org_members_insert', 'owners_can_create_invitations', 'owners_can_update_invitations')), true);
  perform set_config('smc_dryrun.fn_md5_before', (
    select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
     where p.oid = 'public.approve_join_request(uuid)'::regprocedure), true);
  perform set_config('smc_dryrun.fn_meta_before', (
    select concat_ws('|', p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                     coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner), p.prorettype::regtype::text)
      from pg_proc p where p.oid = 'public.approve_join_request(uuid)'::regprocedure), true);

  select array_agg(x.user_id order by x.created_at, x.user_id) into pick
    from (select p.user_id, u.created_at
            from public.profiles p
            join auth.users u on u.id = p.user_id
           where u.email_confirmed_at is not null
             and nullif(btrim(u.email), '') is not null
             and coalesce(p.persona::text, '') not in ('admin', 'moderator')
             and not exists (select 1 from public.organization_members m where m.user_id = p.user_id)
             and not exists (select 1 from public.organizations o
                              where o.owner_user_id = p.user_id or o.created_by_user_id = p.user_id)
             and not exists (select 1 from public.organization_invitations i
                              where lower(btrim(i.email)) = lower(btrim(u.email)))
             and not exists (select 1 from public.org_claim_attempt a where a.user_id = p.user_id)
           order by u.created_at, p.user_id
           limit 6) x;
  select p.user_id into staff
    from public.profiles p
   where p.persona = 'admin' and p.access_status = 'verified'
   order by p.user_id
   limit 1;
  perform set_config('smc_dryrun.pick', coalesce(array_to_string(pick, ','), ''), true);
  perform set_config('smc_dryrun.staff', coalesce(staff::text, ''), true);
  perform set_config('smc_dryrun.before', 'yes', true);
end
$before$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. The migration, verbatim
-- ════════════════════════════════════════════════════════════════════════════
-- ─── 0. Precondition: approve_join_request is the body this file was built from ────
do $pre$
declare
  v_md5 text;
begin
  -- chr(13) stripped: a CRLF working copy of this file must not look like drift.
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p
   where p.oid = 'public.approve_join_request(uuid)'::regprocedure;
  if v_md5 is distinct from '7ba3768346ea5130dfe05ad115d3ef62'   -- production, 10 Oct 2026
     and v_md5 is distinct from '6fb0ce33247218c832d738c97bb59f2d' then -- this file (re-run)
    raise exception 'org_members_no_forced_join: approve_join_request changed since 10 Oct 2026 (md5 %); re-read it with pg_get_functiondef and rebuild this migration', v_md5;
  end if;
end
$pre$;

-- ─── 1. organization_members: self (owner of record) or staff only ─────────────
-- Was: WITH CHECK (is_org_owner(organization_id))
drop policy if exists org_members_insert on public.organization_members;
create policy org_members_insert on public.organization_members
  for insert to authenticated
  with check (
    (user_id = (select auth.uid())
     and role = 'owner'
     and public.is_org_owner(organization_id))
    or (select public.is_moderator())
  );

-- ─── 2. organization_invitations: owners write invitations, not join requests ──
-- Was: WITH CHECK (EXISTS (owner membership of the row's company))
drop policy if exists owners_can_create_invitations on public.organization_invitations;
create policy owners_can_create_invitations on public.organization_invitations
  for insert to public
  with check (
    exists (select 1 from public.organization_members om
             where om.organization_id = organization_invitations.organization_id
               and om.user_id = auth.uid()
               and om.role = 'owner')
    and status = 'pending'
    and invited_by_user_id = auth.uid()
  );

-- Was: USING (EXISTS (owner membership of the row's company)), no WITH CHECK
drop policy if exists owners_can_update_invitations on public.organization_invitations;
create policy owners_can_update_invitations on public.organization_invitations
  for update to public
  using (
    exists (select 1 from public.organization_members om
             where om.organization_id = organization_invitations.organization_id
               and om.user_id = auth.uid()
               and om.role = 'owner')
  )
  with check (
    exists (select 1 from public.organization_members om
             where om.organization_id = organization_invitations.organization_id
               and om.user_id = auth.uid()
               and om.role = 'owner')
    and status in ('pending', 'cancelled')
  );

-- ─── 3. approve_join_request: only a request the requester filed ───────────────
-- Production body (md5 7ba3768346ea5130dfe05ad115d3ef62) plus invited_by_user_id in the
-- SELECT and ONE check after the owner check (marked "-- 10 Oct 2026"). Signature,
-- return type, language, SECURITY DEFINER, search_path, owner and ACL unchanged
-- (CREATE OR REPLACE keeps the owner and ACL).
CREATE OR REPLACE FUNCTION public.approve_join_request(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invitation   RECORD;
  v_org_verified BOOLEAN;
  v_requester_id UUID;
BEGIN
  SELECT oi.id, oi.organization_id, oi.email, oi.status, oi.invited_by_user_id
    INTO v_invitation FROM organization_invitations oi WHERE oi.id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Join request not found'; END IF;
  IF v_invitation.status <> 'join_requested' THEN
    RAISE EXCEPTION 'This request is not in join_requested status (current: %)', v_invitation.status;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization_members om
     WHERE om.organization_id = v_invitation.organization_id
       AND om.user_id = auth.uid() AND om.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the organization owner can approve join requests';
  END IF;

  -- 10 Oct 2026: a join request is filed by the requester themself (request_org_join
  -- leaves invited_by_user_id NULL). A row an owner wrote is an invitation: only the
  -- invited person can accept it (accept_org_invitation).
  IF v_invitation.invited_by_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This is an invitation, not a join request: only the invited person can accept it';
  END IF;

  -- Only an account whose address is confirmed can be the requester.
  SELECT u.id INTO v_requester_id FROM auth.users u
   WHERE lower(u.email) = lower(v_invitation.email)
     AND u.email_confirmed_at IS NOT NULL;
  IF v_requester_id IS NULL THEN RAISE EXCEPTION 'Requesting user account not found'; END IF;

  UPDATE organization_invitations SET status='accepted', updated_at=now() WHERE id = p_invitation_id;
  INSERT INTO organization_members (user_id, organization_id, role)
  VALUES (v_requester_id, v_invitation.organization_id, 'collaborator')
  ON CONFLICT DO NOTHING;

  SELECT (o.access_status = 'verified') INTO v_org_verified
    FROM organizations o WHERE o.id = v_invitation.organization_id;

  IF v_org_verified THEN
    UPDATE profiles SET access_status='verified', onboarding_status='completed', updated_at=now()
     WHERE user_id = v_requester_id;
  ELSE
    UPDATE profiles SET onboarding_status='submitted', updated_at=now()
     WHERE user_id = v_requester_id AND access_status <> 'verified';
  END IF;
END;
$function$;
-- ════════════════════════════════════════════════════════════════════════════
-- 2. Checks on the migrated state
-- ════════════════════════════════════════════════════════════════════════════
do $dryrun$
declare
  nl constant text := chr(10);
  undo constant text := 'DRYRUN_UNDO';
  r text := '';
  v text;
  v2 text;
  n int;
  j jsonb;
  pick uuid[];
  staff uuid;
  u_owner uuid;
  u_stranger uuid;
  u_invitee uuid;
  u_requester uuid;
  u_claimer uuid;
  u_creator uuid;
  e_invitee text;
  e_requester text;
  f uuid;
  g uuid;
  inv uuid;
  code text;
begin
  -- ── T0 one transaction; the test people ──────────────────────────────────
  r := case when current_setting('smc_dryrun.before', true) = 'yes'
            then 'PASS T0 before-snapshot present (one transaction)'
            else 'FAIL T0 before-snapshot missing: NOT one transaction, the migration may be COMMITTED' end;
  pick := string_to_array(nullif(current_setting('smc_dryrun.pick', true), ''), ',')::uuid[];
  staff := nullif(current_setting('smc_dryrun.staff', true), '')::uuid;
  r := r || nl || case when coalesce(array_length(pick, 1), 0) = 6 then 'PASS ' else 'FAIL ' end
            || 'T0 six test people found (' || coalesce(array_length(pick, 1), 0) || ')';
  r := r || nl || case when staff is not null then 'PASS ' else 'FAIL ' end || 'T0 a verified admin found';
  u_owner := pick[1];
  u_stranger := pick[2];
  u_invitee := pick[3];
  u_requester := pick[4];
  u_claimer := pick[5];
  u_creator := pick[6];
  select lower(btrim(u.email)) into e_invitee from auth.users u where u.id = u_invitee;
  select lower(btrim(u.email)) into e_requester from auth.users u where u.id = u_requester;

  -- ── T1 the new rules are in place, everything else is identical ─────────
  select p.with_check, p.roles::text into v, v2 from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'organization_members' and p.policyname = 'org_members_insert';
  r := r || nl || case when v like '%is_org_owner(organization_id)%' and v like '%auth.uid()%'
                         and v like '%''owner''::text%' and v like '%is_moderator()%' and v2 = '{authenticated}'
                       then 'PASS T1 org_members_insert = own owner row of a company one owns, or staff'
                       else 'FAIL T1 org_members_insert is ' || coalesce(v2, '?') || ' ' || coalesce(v, 'missing') end;
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'organization_members' and p.cmd = 'UPDATE';
  r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end
            || 'T1 organization_members has no UPDATE policy (' || n || ')';
  select p.with_check into v from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'organization_invitations' and p.policyname = 'owners_can_create_invitations';
  r := r || nl || case when v like '%''owner''::text%' and v like '%''pending''::text%'
                         and v like '%invited_by_user_id = auth.uid()%'
                       then 'PASS T1 owners_can_create_invitations = owner, pending, signed by the caller'
                       else 'FAIL T1 owners_can_create_invitations is ' || coalesce(v, 'missing') end;
  select p.qual, p.with_check into v, v2 from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'organization_invitations' and p.policyname = 'owners_can_update_invitations';
  r := r || nl || case when v like '%''owner''::text%' and v2 like '%''owner''::text%' and v2 like '%''cancelled''::text%'
                         and v2 not like '%join_requested%'
                       then 'PASS T1 owners_can_update_invitations ends pending or cancelled'
                       else 'FAIL T1 owners_can_update_invitations is ' || coalesce(v, 'missing') || ' / ' || coalesce(v2, 'missing') end;
  select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, cmd, roles, qual, with_check), ';' order by tablename, policyname), ''))
    into v from pg_policies
   where schemaname = 'public' and tablename in ('organization_members', 'organization_invitations')
     and policyname not in ('org_members_insert', 'owners_can_create_invitations', 'owners_can_update_invitations');
  r := r || nl || case when v = current_setting('smc_dryrun.pol_others_before', true) then 'PASS ' else 'FAIL ' end
            || 'T1 every other policy of both tables is unchanged';
  select count(*) into n from pg_class c
   where c.oid in ('public.organization_members'::regclass, 'public.organization_invitations'::regclass)
     and c.relrowsecurity;
  r := r || nl || case when n = 2 then 'PASS ' else 'FAIL ' end || 'T1 RLS still on for both tables (' || n || ')';
  select md5(replace(p.prosrc, chr(13), '')),
         concat_ws('|', p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                   coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner), p.prorettype::regtype::text)
    into v, v2 from pg_proc p where p.oid = 'public.approve_join_request(uuid)'::regprocedure;
  r := r || nl || case when v = '6fb0ce33247218c832d738c97bb59f2d' then 'PASS ' else 'FAIL ' end
            || 'T1 approve_join_request body is the patched one (' || coalesce(v, '?') || ')';
  r := r || nl || case when v2 = current_setting('smc_dryrun.fn_meta_before', true) then 'PASS ' else 'FAIL ' end
            || 'T1 approve_join_request keeps SECURITY DEFINER, search_path, owner, ACL, return type';

  -- ── T2 the owner of a company adds a stranger: refused ───────────────────
  begin
    f := null;
    inv := null;
    insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
    values ('DRYRUN T2', 'dryrun-t2-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
    insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'owner');

    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_stranger, 'collaborator');
      r := r || nl || 'FAIL T2 an owner could add a stranger as collaborator';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T2 an owner adding a stranger as collaborator is refused (42501)';
      when others then r := r || nl || 'FAIL T2 stranger as collaborator: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_stranger, 'owner');
      r := r || nl || 'FAIL T2 an owner could add a stranger as owner';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T2 an owner adding a stranger as owner is refused (42501)';
      when others then r := r || nl || 'FAIL T2 stranger as owner: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m where m.organization_id = f and m.user_id = u_stranger;
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end || 'T2 the stranger is not a member (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T2 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T3 create_organization works; the new owner still cannot add a stranger ──
  begin
    f := null;
    inv := null;
    perform set_config('request.jwt.claims', json_build_object('sub', u_creator, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      select public.create_organization('DRYRUN T3', 'partner') into f;
      r := r || nl || case when f is not null then 'PASS ' else 'FAIL ' end
                || 'T3 create_organization still works for a person without a company';
    exception when others then
      r := r || nl || 'FAIL T3 create_organization: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_stranger, 'collaborator');
      r := r || nl || 'FAIL T3 the creator of a new company could add a stranger';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T3 the creator of a new company adding a stranger is refused (42501)';
      when others then r := r || nl || 'FAIL T3 stranger: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m
      join public.organizations o on o.id = m.organization_id
     where m.organization_id = f and m.user_id = u_creator and m.role = 'owner' and o.owner_user_id = u_creator;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end
              || 'T3 the creator is owner member and owner of record (' || n || ')';
    select count(*) into n from public.organization_members m where m.organization_id = f;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'T3 the new company has one member (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T3 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T4 self-service: create a company directly, then join it as its owner ──
  begin
    f := null;
    inv := null;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
      values ('DRYRUN T4', 'dryrun-t4-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
      r := r || nl || 'PASS T4 a person creates a company directly (org_insert, unchanged)';
    exception when others then
      r := r || nl || 'FAIL T4 direct company insert: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'collaborator');
      r := r || nl || 'FAIL T4 the owner of record could join their company as collaborator';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T4 the owner of record joining as collaborator is refused (owner row only)';
      when others then r := r || nl || 'FAIL T4 self as collaborator: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'owner');
      r := r || nl || 'PASS T4 the owner of record joins their own company as owner';
    exception when others then
      r := r || nl || 'FAIL T4 self as owner: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_stranger, 'collaborator');
      r := r || nl || 'FAIL T4 a person could join a company they do not own';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T4 a person joining a company they do not own is refused (42501)';
      when others then r := r || nl || 'FAIL T4 self-join: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m where m.organization_id = f;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'T4 the company has exactly its owner (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T4 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T5 team invitation (both clients) + accept_org_invitation ────────────
  begin
    f := null;
    inv := null;
    insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
    values ('DRYRUN T5', 'dryrun-t5-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
    insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'owner');

    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.organization_invitations (organization_id, email, normalized_domain, invited_by_user_id, first_name, last_name)
      values (f, e_invitee, split_part(e_invitee, '@', 2), u_owner, null, null) returning id into inv;
      r := r || nl || 'PASS T5 the owner invites a colleague (pending, signed by themself), as both clients do';
    exception when others then
      r := r || nl || 'FAIL T5 invitation insert: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', u_invitee, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.accept_org_invitation(inv);
      r := r || nl || 'PASS T5 the invitee accepts (accept_org_invitation)';
    exception when others then
      r := r || nl || 'FAIL T5 accept_org_invitation: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m
     where m.organization_id = f and m.user_id = u_invitee and m.role = 'collaborator';
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'T5 the invitee is a collaborator (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T5 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T6 join request (request_org_join) + approve_join_request ───────────
  begin
    f := null;
    inv := null;
    insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
    values ('DRYRUN T6', 'dryrun-t6-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
    insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'owner');

    perform set_config('request.jwt.claims', json_build_object('sub', u_requester, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.request_org_join(f);
      r := r || nl || 'PASS T6 a person asks to join (request_org_join)';
    exception when others then
      r := r || nl || 'FAIL T6 request_org_join: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    select i.id into inv from public.organization_invitations i
     where i.organization_id = f and i.status = 'join_requested' and i.invited_by_user_id is null;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.approve_join_request(inv);
      r := r || nl || 'PASS T6 the owner approves the request (approve_join_request)';
    exception when others then
      r := r || nl || 'FAIL T6 approve_join_request: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m
     where m.organization_id = f and m.user_id = u_requester and m.role = 'collaborator';
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'T6 the requester is a collaborator (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T6 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T7 forged join requests: refused at the table and at approve_join_request ──
  begin
    f := null;
    inv := null;
    insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
    values ('DRYRUN T7', 'dryrun-t7-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
    insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'owner');

    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.organization_invitations (organization_id, email, invited_by_user_id, status)
      values (f, e_requester, u_owner, 'join_requested');
      r := r || nl || 'FAIL T7 an owner could write a join request for someone else';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T7 an owner writing a join request for someone else is refused (42501)';
      when others then r := r || nl || 'FAIL T7 signed join request: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_invitations (organization_id, email, invited_by_user_id, status)
      values (f, e_requester, null, 'join_requested');
      r := r || nl || 'FAIL T7 an owner could write an unsigned join request for someone else';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T7 an owner writing an unsigned join request is refused (42501)';
      when others then r := r || nl || 'FAIL T7 unsigned join request: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_invitations (organization_id, email, invited_by_user_id, status)
      values (f, e_requester, u_owner, 'accepted');
      r := r || nl || 'FAIL T7 an owner could write an already-accepted invitation';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T7 an owner writing an already-accepted invitation is refused (42501)';
      when others then r := r || nl || 'FAIL T7 accepted insert: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_invitations (organization_id, email, invited_by_user_id)
      values (f, e_requester, u_stranger);
      r := r || nl || 'FAIL T7 an owner could sign an invitation with someone else''s id';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T7 an invitation signed with someone else''s id is refused (42501)';
      when others then r := r || nl || 'FAIL T7 foreign signature: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_invitations (organization_id, email, invited_by_user_id)
      values (f, e_requester, u_owner) returning id into inv;
      r := r || nl || 'PASS T7 a pending invitation signed by the owner goes in (setup)';
    exception when others then
      r := r || nl || 'FAIL T7 pending invitation: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      update public.organization_invitations set status = 'join_requested' where id = inv;
      r := r || nl || 'FAIL T7 an owner could turn an invitation into a join request';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T7 turning an invitation into a join request is refused (42501)';
      when others then r := r || nl || 'FAIL T7 flip to join_requested: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      update public.organization_invitations set status = 'accepted' where id = inv;
      r := r || nl || 'FAIL T7 an owner could mark an invitation accepted';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T7 marking an invitation accepted is refused (42501)';
      when others then r := r || nl || 'FAIL T7 flip to accepted: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      update public.organization_invitations set status = 'cancelled' where id = inv;
      get diagnostics n = row_count;
      r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end
                || 'T7 the owner can still cancel an invitation, as both clients do (' || n || ' row)';
    exception when others then
      r := r || nl || 'FAIL T7 cancel: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    -- A row forged before this migration (written here as the table owner).
    insert into public.organization_invitations (organization_id, email, invited_by_user_id, status)
    values (f, e_requester, u_owner, 'join_requested') returning id into inv;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.approve_join_request(inv);
      r := r || nl || 'FAIL T7 approve_join_request approved an owner-written row';
    exception
      when raise_exception then
        r := r || nl || case when sqlerrm like 'This is an invitation, not a join request%' then 'PASS ' else 'FAIL ' end
                  || 'T7 approve_join_request refuses an owner-written row (' || sqlerrm || ')';
      when others then r := r || nl || 'FAIL T7 approve forged: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m where m.organization_id = f and m.user_id = u_requester;
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end || 'T7 the person was not added (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T7 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T8 claim_organization (claim code) ───────────────────────────────────
  begin
    f := null;
    inv := null;
    code := 'DRYRUN-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
    insert into public.organizations (name, slug, claim_code)
    values ('DRYRUN T8', 'dryrun-t8-' || gen_random_uuid(), code) returning id into f;

    perform set_config('request.jwt.claims', json_build_object('sub', u_claimer, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      select public.claim_organization(code) into j;
      r := r || nl || case when j->>'role' = 'owner' and j->>'organization_id' = f::text then 'PASS ' else 'FAIL ' end
                || 'T8 claim_organization still works (' || coalesce(j::text, 'null') || ')';
    exception when others then
      r := r || nl || 'FAIL T8 claim_organization: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m
      join public.organizations o on o.id = m.organization_id
     where m.organization_id = f and m.user_id = u_claimer and m.role = 'owner' and o.owner_user_id = u_claimer;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end
              || 'T8 the claimer is owner member and owner of record (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T8 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T9 staff ─────────────────────────────────────────────────────────────
  begin
    f := null;
    inv := null;
    insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
    values ('DRYRUN T9', 'dryrun-t9-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
    insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'owner');

    perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_stranger, 'collaborator');
      r := r || nl || 'PASS T9 a verified admin adds a member directly (is_moderator)';
    exception when others then
      r := r || nl || 'FAIL T9 staff insert: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform public.admin_add_org_member(u_invitee, f, 'collaborator');
      r := r || nl || 'PASS T9 admin_add_org_member still works (admin screens)';
    exception when others then
      r := r || nl || 'FAIL T9 admin_add_org_member: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m where m.organization_id = f;
    r := r || nl || case when n = 3 then 'PASS ' else 'FAIL ' end || 'T9 the company has 3 members (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T9 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T10 the service role (sm26-provision, sm26-attendee-invite, sponsor-invite,
  --        claim-code-signup -> claim_organization_for_user) ──────────────────
  begin
    f := null;
    g := null;
    inv := null;
    insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
    values ('DRYRUN T10', 'dryrun-t10-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
    insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'owner');
    code := 'DRYRUN-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
    insert into public.organizations (name, slug, claim_code)
    values ('DRYRUN T10 claim', 'dryrun-t10c-' || gen_random_uuid(), code) returning id into g;

    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_stranger, 'collaborator');
      r := r || nl || 'PASS T10 the service role (edge functions) still inserts members';
    exception when others then
      r := r || nl || 'FAIL T10 service_role insert: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      select public.claim_organization_for_user(u_claimer, code) into j;
      r := r || nl || case when j->>'role' = 'owner' and j->>'organization_id' = g::text then 'PASS ' else 'FAIL ' end
                || 'T10 claim_organization_for_user (claim-code-signup) still works (' || coalesce(j::text, 'null') || ')';
    exception when others then
      r := r || nl || 'FAIL T10 claim_organization_for_user: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.claim_organization_for_user(u_stranger, code);
      r := r || nl || 'FAIL T10 a signed-in person could call claim_organization_for_user';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T10 claim_organization_for_user is not callable by a signed-in person (42501)';
      when others then r := r || nl || 'FAIL T10 claim_organization_for_user as authenticated: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m
      join public.organizations o on o.id = m.organization_id
     where m.organization_id = g and m.user_id = u_claimer and m.role = 'owner' and o.owner_user_id = u_claimer;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end
              || 'T10 the claimer is owner member and owner of record (' || n || ')';
    select count(*) into n from public.organization_members m where m.organization_id = g;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end || 'T10 the claimed company has one member (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T10 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T11 anon ─────────────────────────────────────────────────────────────
  begin
    f := null;
    inv := null;
    insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
    values ('DRYRUN T11', 'dryrun-t11-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
    insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'owner');

    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_stranger, 'collaborator');
      r := r || nl || 'FAIL T11 anon could insert a member';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T11 anon inserting a member is refused (42501)';
      when others then r := r || nl || 'FAIL T11 anon member insert: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_invitations (organization_id, email, invited_by_user_id, status)
      values (f, e_requester, null, 'join_requested');
      r := r || nl || 'FAIL T11 anon could write an invitation';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T11 anon writing an invitation is refused (42501)';
      when others then r := r || nl || 'FAIL T11 anon invitation insert: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T11 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  -- ── T12 UPDATE stays closed: no self-promotion, no rewriting someone's row ──
  begin
    f := null;
    inv := null;
    insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
    values ('DRYRUN T12', 'dryrun-t12-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
    insert into public.organization_members (organization_id, user_id, role)
    values (f, u_owner, 'owner'), (f, u_invitee, 'collaborator');

    perform set_config('request.jwt.claims', json_build_object('sub', u_invitee, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.organization_members set role = 'owner' where organization_id = f and user_id = u_invitee;
    get diagnostics n = row_count;
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end
              || 'T12 a member promoting themself to owner changes no row (' || n || ')';
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_invitee, 'owner')
      on conflict (user_id, organization_id) do update set role = 'owner';
      r := r || nl || 'FAIL T12 a member could upsert themself as owner';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T12 a member upserting themself as owner is refused (42501)';
      when others then r := r || nl || 'FAIL T12 upsert: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_stranger, 'collaborator');
      r := r || nl || 'FAIL T12 a collaborator could add a stranger';
    exception
      when insufficient_privilege then r := r || nl || 'PASS T12 a collaborator adding a stranger is refused (42501)';
      when others then r := r || nl || 'FAIL T12 collaborator adds stranger: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      update public.organizations set owner_user_id = u_invitee where id = f;
    exception when others then
      null; -- either way, the check below is what counts
    end;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.organization_members set role = 'owner' where organization_id = f and user_id = u_invitee;
    get diagnostics n = row_count;
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end
              || 'T12 the owner rewriting a member''s role changes no row (' || n || ')';
    update public.organization_members set user_id = u_stranger where organization_id = f and user_id = u_invitee;
    get diagnostics n = row_count;
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end
              || 'T12 the owner swapping a member for a stranger changes no row (' || n || ')';
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select m.role into v from public.organization_members m where m.organization_id = f and m.user_id = u_invitee;
    r := r || nl || case when v = 'collaborator' then 'PASS ' else 'FAIL ' end
              || 'T12 the member is still a collaborator (' || coalesce(v, 'gone') || ')';
    select count(*) into n from public.organizations o where o.id = f and o.owner_user_id = u_owner;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end
              || 'T12 the owner of record is unchanged after the member''s attempt (' || n || ')';
    select count(*) into n from public.organization_members m where m.organization_id = f and m.user_id = u_stranger;
    r := r || nl || case when n = 0 then 'PASS ' else 'FAIL ' end || 'T12 the stranger is not a member (' || n || ')';
    -- The legitimate way to make a member owner is unchanged (OrganizationTab, both clients).
    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.transfer_org_ownership(f, u_invitee);
      r := r || nl || 'PASS T12 the owner hands the company to a member (transfer_org_ownership)';
    exception when others then
      r := r || nl || 'FAIL T12 transfer_org_ownership: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from public.organization_members m
      join public.organizations o on o.id = m.organization_id
     where m.organization_id = f and m.user_id = u_invitee and m.role = 'owner' and o.owner_user_id = u_invitee;
    r := r || nl || case when n = 1 then 'PASS ' else 'FAIL ' end
              || 'T12 after the transfer the member is owner member and owner of record (' || n || ')';
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T12 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  perform set_config('smc_dryrun.report', r, true);
end
$dryrun$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. The down script, verbatim
-- ════════════════════════════════════════════════════════════════════════════
-- ─── 0. Precondition: approve_join_request is the patched body or already restored ──
do $pre$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p
   where p.oid = 'public.approve_join_request(uuid)'::regprocedure;
  if v_md5 is distinct from '6fb0ce33247218c832d738c97bb59f2d'   -- the up file
     and v_md5 is distinct from '7ba3768346ea5130dfe05ad115d3ef62' then -- production before
    raise exception 'org_members_no_forced_join DOWN: approve_join_request changed since the up migration (md5 %); restore it by hand', v_md5;
  end if;
end
$pre$;

-- ─── 1. organization_members ────────────────────────────────────────────────────
drop policy if exists org_members_insert on public.organization_members;
create policy org_members_insert on public.organization_members
  for insert to authenticated
  with check (public.is_org_owner(organization_id));

-- ─── 2. organization_invitations ────────────────────────────────────────────────
drop policy if exists owners_can_create_invitations on public.organization_invitations;
create policy owners_can_create_invitations on public.organization_invitations
  for insert to public
  with check (
    exists (select 1 from public.organization_members om
             where om.organization_id = organization_invitations.organization_id
               and om.user_id = auth.uid()
               and om.role = 'owner')
  );

drop policy if exists owners_can_update_invitations on public.organization_invitations;
create policy owners_can_update_invitations on public.organization_invitations
  for update to public
  using (
    exists (select 1 from public.organization_members om
             where om.organization_id = organization_invitations.organization_id
               and om.user_id = auth.uid()
               and om.role = 'owner')
  );

-- ─── 3. approve_join_request: production body of 10 Oct 2026 ────────────────────
CREATE OR REPLACE FUNCTION public.approve_join_request(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invitation   RECORD;
  v_org_verified BOOLEAN;
  v_requester_id UUID;
BEGIN
  SELECT oi.id, oi.organization_id, oi.email, oi.status
    INTO v_invitation FROM organization_invitations oi WHERE oi.id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Join request not found'; END IF;
  IF v_invitation.status <> 'join_requested' THEN
    RAISE EXCEPTION 'This request is not in join_requested status (current: %)', v_invitation.status;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization_members om
     WHERE om.organization_id = v_invitation.organization_id
       AND om.user_id = auth.uid() AND om.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the organization owner can approve join requests';
  END IF;

  -- Only an account whose address is confirmed can be the requester.
  SELECT u.id INTO v_requester_id FROM auth.users u
   WHERE lower(u.email) = lower(v_invitation.email)
     AND u.email_confirmed_at IS NOT NULL;
  IF v_requester_id IS NULL THEN RAISE EXCEPTION 'Requesting user account not found'; END IF;

  UPDATE organization_invitations SET status='accepted', updated_at=now() WHERE id = p_invitation_id;
  INSERT INTO organization_members (user_id, organization_id, role)
  VALUES (v_requester_id, v_invitation.organization_id, 'collaborator')
  ON CONFLICT DO NOTHING;

  SELECT (o.access_status = 'verified') INTO v_org_verified
    FROM organizations o WHERE o.id = v_invitation.organization_id;

  IF v_org_verified THEN
    UPDATE profiles SET access_status='verified', onboarding_status='completed', updated_at=now()
     WHERE user_id = v_requester_id;
  ELSE
    UPDATE profiles SET onboarding_status='submitted', updated_at=now()
     WHERE user_id = v_requester_id AND access_status <> 'verified';
  END IF;
END;
$function$;
-- ════════════════════════════════════════════════════════════════════════════
-- 4. Checks after the down script, and the report
-- ════════════════════════════════════════════════════════════════════════════
do $after$
declare
  nl constant text := chr(10);
  undo constant text := 'DRYRUN_UNDO';
  r text;
  v text;
  n int;
  n_pass int;
  n_fail int;
  pick uuid[];
  u_owner uuid;
  u_stranger uuid;
  u_requester uuid;
  e_requester text;
  f uuid;
  inv uuid;
begin
  r := coalesce(nullif(current_setting('smc_dryrun.report', true), ''), 'FAIL the report of part 2 is lost');
  pick := string_to_array(nullif(current_setting('smc_dryrun.pick', true), ''), ',')::uuid[];
  u_owner := pick[1];
  u_stranger := pick[2];
  u_requester := pick[4];
  select lower(btrim(u.email)) into e_requester from auth.users u where u.id = u_requester;

  -- ── T13 the down script restores the policies and the function exactly ──
  select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, cmd, roles, qual, with_check), ';' order by tablename, policyname), ''))
    into v from pg_policies
   where schemaname = 'public' and tablename in ('organization_members', 'organization_invitations');
  r := r || nl || case when v = current_setting('smc_dryrun.pol_all_before', true) then 'PASS ' else 'FAIL ' end
            || 'T13 down script: every policy of both tables is back exactly';
  select md5(replace(p.prosrc, chr(13), '')) into v from pg_proc p
   where p.oid = 'public.approve_join_request(uuid)'::regprocedure;
  r := r || nl || case when v = current_setting('smc_dryrun.fn_md5_before', true) and v = '7ba3768346ea5130dfe05ad115d3ef62'
                       then 'PASS ' else 'FAIL ' end
            || 'T13 down script: approve_join_request body is back (' || coalesce(v, '?') || ')';
  select concat_ws('|', p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                   coalesce(p.proacl::text, ''), pg_get_userbyid(p.proowner), p.prorettype::regtype::text)
    into v from pg_proc p where p.oid = 'public.approve_join_request(uuid)'::regprocedure;
  r := r || nl || case when v = current_setting('smc_dryrun.fn_meta_before', true) then 'PASS ' else 'FAIL ' end
            || 'T13 down script: approve_join_request attributes unchanged';

  -- ── T14 after the down script both holes are back (so T2 and T7 do detect them) ──
  begin
    f := null;
    inv := null;
    insert into public.organizations (name, slug, owner_user_id, created_by_user_id)
    values ('DRYRUN T14', 'dryrun-t14-' || gen_random_uuid(), u_owner, u_owner) returning id into f;
    insert into public.organization_members (organization_id, user_id, role) values (f, u_owner, 'owner');

    perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (f, u_stranger, 'collaborator');
      r := r || nl || 'PASS T14 after the down script an owner can add a stranger again (old behaviour back)';
    exception when others then
      r := r || nl || 'FAIL T14 old owner insert: ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.organization_invitations (organization_id, email, invited_by_user_id, status)
      values (f, e_requester, u_owner, 'join_requested') returning id into inv;
      perform public.approve_join_request(inv);
      r := r || nl || 'PASS T14 after the down script a forged join request is approved again (old behaviour back)';
    exception when others then
      r := r || nl || 'FAIL T14 old forged join request: ' || sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    raise exception '%', undo;
  exception when others then
    if sqlerrm is distinct from undo then r := r || nl || 'FAIL T14 block: ' || sqlstate || ' ' || sqlerrm; end if;
  end;

  select count(*) filter (where l like 'PASS%'), count(*) filter (where l like 'FAIL%')
    into n_pass, n_fail
    from regexp_split_to_table(r, nl) as t(l);
  r := r || nl || 'SUMMARY ' || n_pass || ' PASS, ' || n_fail || ' FAIL';
  raise exception 'DRYRUN %', coalesce(r, '(report lost: a NULL was concatenated)');
end
$after$;
