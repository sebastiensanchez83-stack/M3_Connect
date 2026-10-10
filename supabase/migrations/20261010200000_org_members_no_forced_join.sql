-- Nobody can make SOMEONE ELSE a member of a company without that person's consent or
-- an M3 admin (security fix, 10 Oct 2026; workstream 12 of chantiers-en-cours).
--
-- NOT APPLIED. Written on branch rf-sec. Down script:
-- supabase/migrations/down/20261010200000_org_members_no_forced_join.down.sql. Dry run:
-- supabase/dryrun/20261010200000_org_members_no_forced_join.dryrun.sql (run it first, in
-- ONE execute_sql call; every line must say PASS).
-- Supersedes the unreviewed draft "org_members_insert_self_only" (stash@{0} on the rf-msg
-- worktree, migration 20261010100000): that stash must be DROPPED, never applied. It
-- left the forged-join-request path below open, and step 0 of this file refuses to run
-- over its policy.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- 1. organization_members.org_members_insert was WITH CHECK is_org_owner(organization_id)
--    only. Any signed-in account can own a company (create_organization, one call), so
--    the owner of a made-up company could insert ANY user id, with role 'owner' or
--    'collaborator'. Membership is what "speaks for and reads for" a company:
--      * msg_user_org_ids / msg_side / msg_can_access: the forced member sees the
--        company's connection requests and conversations, is counted in its Friday
--        digest, and the requests they send from the OLD live site (no
--        partner_organization_id) are filed under the made-up company when the forced
--        row has role 'owner' (partner_request_user_org prefers it), so the attacker
--        reads them;
--      * is_org_member: sm_can_access_registration, org invitations, org documents, ...;
--      * transfer_org_ownership only needs the new owner to be a member: once forced in,
--        the victim could be made owner of record of the made-up company.
-- 2. The same result through a legitimate RPC: owners_can_create_invitations and
--    owners_can_update_invitations let an owner write an organization_invitations row
--    with ANY e-mail and ANY status. An owner could write {status 'join_requested',
--    email <victim's sign-in address>} (or flip a pending invitation to that status) and
--    call approve_join_request, which then inserts the victim as a collaborator. A real
--    join request is only ever filed by request_org_join, for the caller's own confirmed
--    address, with invited_by_user_id NULL.
-- 3. The table-level UPDATE grant on organization_invitations also let an owner rewrite
--    invited_by_user_id (sign an invitation with someone else's id: it then shows in
--    that person's Inbox, and they can trigger reminder e-mails for it), the e-mail or
--    the company of an invitation. Both clients only ever UPDATE status ('cancelled').
--
-- ════════════════════════════════════════════════════════════════════════════
-- Inventory of every legitimate way into organization_members (10 Oct 2026)
-- ════════════════════════════════════════════════════════════════════════════
--  SECURITY DEFINER, owner postgres (RLS does not apply to their writes):
--    create_organization           creator joins as owner (both clients: OnboardingPage,
--                                  OrganizationTab)
--    claim_organization            claimer joins with a claim code (both clients:
--                                  OnboardingPage)
--    claim_organization_for_user   service_role only (claim-code-signup)
--    accept_org_invitation         the invitee joins, address must match (both clients:
--                                  JoinPage, OnboardingPage; refonte dashboard invite)
--    approve_join_request          owner approves a request the requester filed
--                                  (main: OrganizationTab, InboxTab; refonte: orgActions)
--    admin_add_org_member          verified admin (AdminUserOrgs, both clients)
--    admin_set_org_owner / transfer_org_ownership: promote an EXISTING member only.
--  Service role (bypasses RLS): sm26-provision (staff), sm26-attendee-invite (staff or
--    the SM26 registration's owner/members while the roster is open; for non-staff it
--    fails closed since the SM26 roster lock passed on 21 Sep 2026), sponsor-invite
--    (staff or Yacht Club manager), claim-code-signup (claim_organization_for_user,
--    EXECUTE for service_role only); provision-person (registration Phase 1, not
--    deployed yet).
--  Invitations that the invitee then accepts: owners (client INSERT, below) and staff
--    (admin_invite_org_member, SECURITY DEFINER, is_admin()).
--  No trigger inserts members (triggers on organizations, organization_members,
--    organization_invitations and auth.users checked).
--  Direct client INSERTs: none live. A person cannot INSERT a company directly
--    (INSERT on organizations revoked from anon and authenticated on 7 Oct 2026,
--    20261007093512_sec_hide_claim_codes_from_authenticated.sql), so there is no
--    "create a company, then add my own owner row" bootstrap either, and no owner of
--    record lacks their own row (0 on 10 Oct 2026). OnboardingPage (main and refonte)
--    still has two inserts of the user themself into a "detected" company, but
--    detectedOrg is only set from an existing join request and never carries
--    auto_approve, so both are dead code, already refused today.
--  Team invitations (both clients): the owner INSERTs a 'pending' invitation with
--    invited_by_user_id = themself and may UPDATE its status to 'cancelled'; nothing else.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What changes
-- ════════════════════════════════════════════════════════════════════════════
-- 1. org_members_insert (authenticated): a direct INSERT is allowed only for a verified
--    admin (is_admin(), the same rule as admin_add_org_member). No self-service branch:
--    no legitimate flow inserts a member directly (inventory above). Moderators (none
--    verified today) never had admin_add_org_member either, so they lose nothing.
-- 2. owners_can_create_invitations (public): same owner check, plus status 'pending'
--    and invited_by_user_id = auth.uid().
--    owners_can_update_invitations (public): same USING, plus a WITH CHECK: the row
--    stays the caller's company's and its status ends 'pending' or 'cancelled'.
--    So an owner can no longer write a 'join_requested' (or 'accepted') row.
-- 3. organization_invitations grants: UPDATE is revoked from anon and authenticated and
--    granted back to authenticated on the status column only. The owner's cancel works
--    as before; invited_by_user_id, email, organization_id, token, expires_at, ... can
--    no longer be rewritten by a person (updated_at is set by its trigger, which needs
--    no column grant). SECURITY DEFINER functions and the service role are unaffected.
-- 4. approve_join_request: refuses a row with invited_by_user_id set (an owner-written
--    invitation is accepted by the invitee, never "approved" by the owner). An UNSIGNED
--    row an owner wrote before this migration would still look like a real request, so
--    step 0 refuses the first apply while any join request exists (production had none
--    on 10 Oct 2026: 7 invitations, all signed by the owner or staff member who sent
--    them: 5 accepted, 1 pending, 1 cancelled).
-- 5. The three policies get a COMMENT holding their fingerprint, so a re-run and the
--    down script can tell "this file's policy" from someone else's.
--
-- organization_members UPDATE: there is NO update policy, so a direct UPDATE changes no
-- row (a member cannot promote themself, an owner cannot rewrite someone's row).
-- organizations.owner_user_id is frozen for self-service by guard_org_sensitive_columns.
-- Left as they are; the dry run proves both.
--
-- Existing rows (read-only, 10 Oct 2026; nothing here changes them): 136 memberships.
--   114 owner rows, all equal to organizations.owner_user_id (no forced owner row).
--   22 collaborator rows: 16 have a trace that explains the join (13 SM26 roster or
--   registration created before or with the join, 2 accepted invitations, 1 creator who
--   later handed the company over); 6 have none. 3 of the 6 (April 2026, one company)
--   have a confirmed sign-in address on the company's primary domain, consistent with
--   the domain auto-join closed on 6 Oct 2026; 3 (July 2026) remain unexplained. All
--   joined before company messaging existed. Ids are in the lane report, not in this
--   public file. No membership was created after 6 Oct 2026 08:42 UTC.
--
-- Locks: step 0 takes ACCESS EXCLUSIVE on organization_members and
-- organization_invitations (the policy changes need it anyway) until commit: reads of
-- both tables wait for those milliseconds. Taking both first, in a fixed order, avoids a
-- deadlock with a concurrent accept/approve and keeps a new join request from slipping
-- in between check c) and the policy change.
--
-- Unchanged: org_members_delete, org_members_select_*, the other invitation policies,
-- every RPC except approve_join_request, every other grant. No data is touched.
-- Old live client (main): its team invite (pending insert, status-only cancel), accept,
-- approve, create and claim flows pass exactly as before. Idempotent: policies are
-- dropped and recreated, grants re-issued; step 0 accepts the production state or this
-- file's.
--
-- Check after applying (read-only):
--   select p.policyname, p.cmd, p.roles, p.qual, p.with_check,
--          obj_description(pp.oid, 'pg_policy') as marker
--     from pg_policies p
--     join pg_policy pp on pp.polname = p.policyname
--                      and pp.polrelid = format('%I.%I', p.schemaname, p.tablename)::regclass
--    where p.schemaname = 'public'
--      and p.tablename in ('organization_members', 'organization_invitations')
--    order by p.tablename, p.policyname;
--     org_members_insert            -> with_check = ( SELECT is_admin() AS is_admin)
--     owners_can_create_invitations -> with_check mentions 'pending'::text and
--                                      invited_by_user_id
--     owners_can_update_invitations -> with_check mentions 'cancelled'::text
--     the three of them             -> marker 'org_members_no_forced_join <md5>'
--   select has_table_privilege('authenticated', 'public.organization_invitations', 'UPDATE'),
--          has_column_privilege('authenticated', 'public.organization_invitations', 'status', 'UPDATE'),
--          has_any_column_privilege('anon', 'public.organization_invitations', 'UPDATE');
--     -> f, t, f
--   select md5(prosrc) from pg_proc where oid = 'public.approve_join_request(uuid)'::regprocedure;
--     -> 6fb0ce33247218c832d738c97bb59f2d (the body below)

-- ─── 0. Preconditions ───────────────────────────────────────────────────────────
do $pre$
declare
  v_md5 text;
  v_bad text;
  v_sp text := current_setting('search_path');
  n int;
begin
  lock table public.organization_members, public.organization_invitations in access exclusive mode;

  -- a) approve_join_request is the body this file was built from (or this file's).
  --    chr(13) stripped: a CRLF working copy of this file must not look like drift.
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p
   where p.oid = 'public.approve_join_request(uuid)'::regprocedure;
  if v_md5 is distinct from '7ba3768346ea5130dfe05ad115d3ef62'   -- production, 10 Oct 2026
     and v_md5 is distinct from '6fb0ce33247218c832d738c97bb59f2d' then -- this file (re-run)
    raise exception 'org_members_no_forced_join: approve_join_request changed since 10 Oct 2026 (md5 %); re-read it with pg_get_functiondef and rebuild this migration', v_md5;
  end if;

  -- b) The three policies are production's of 10 Oct 2026 (fingerprint) or this file's
  --    (step 5 comment, whose fingerprint must still match). Anything else, e.g. the
  --    rf-msg stash draft, stops here. Fingerprints are read with search_path = public,
  --    as they were computed.
  perform set_config('search_path', 'public', true);
  select string_agg(x.tbl || '.' || x.pol, ', ' order by x.tbl, x.pol) into v_bad
    from (values ('organization_members',     'org_members_insert',            '31863c5e9aefa74adbc150e4a909ac80'),
                 ('organization_invitations', 'owners_can_create_invitations', 'cc091f67c22b733d80ecc6df298112bc'),
                 ('organization_invitations', 'owners_can_update_invitations', 'a83f9f8723e90315326baf1d564f4a2e')) x(tbl, pol, fp)
    left join pg_policies p
      on p.schemaname = 'public' and p.tablename = x.tbl and p.policyname = x.pol
    left join pg_policy pp
      on pp.polrelid = ('public.' || x.tbl)::regclass and pp.polname = x.pol
   where p.policyname is null
      or (md5(format('%s|%s|%s|%s|%s', p.permissive, p.cmd, p.roles, p.qual, p.with_check)) <> x.fp
          and coalesce(obj_description(pp.oid, 'pg_policy'), '')
              <> 'org_members_no_forced_join '
                 || md5(format('%s|%s|%s|%s|%s', p.permissive, p.cmd, p.roles, p.qual, p.with_check)));
  perform set_config('search_path', v_sp, true);
  if v_bad is not null then
    raise exception 'org_members_no_forced_join: policy % is neither the production one of 10 Oct 2026 nor this file''s; read pg_policies and rebuild this migration', v_bad;
  end if;

  -- c) First apply only (function still the production body): no join request may
  --    exist, because an unsigned row an owner forged before this migration cannot be
  --    told apart from a real one and would stay approvable.
  if v_md5 = '7ba3768346ea5130dfe05ad115d3ef62' then
    select count(*) into n from public.organization_invitations where status = 'join_requested';
    if n > 0 then
      raise exception 'org_members_no_forced_join: % join request(s) exist; review them before applying (select id, organization_id, created_at from organization_invitations where status = ''join_requested''): let the owner approve the genuine ones, have staff set the others to ''cancelled''', n;
    end if;
  end if;
end
$pre$;

-- ─── 1. organization_members: verified admin only ──────────────────────────────
-- Was: WITH CHECK (is_org_owner(organization_id))
drop policy if exists org_members_insert on public.organization_members;
create policy org_members_insert on public.organization_members
  for insert to authenticated
  with check ((select public.is_admin()));

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

-- ─── 3. organization_invitations: a person may UPDATE the status column only ────
-- Was: UPDATE on the whole table for anon and authenticated (arwdDxtm), no column grant.
revoke update on public.organization_invitations from anon, authenticated;
grant update (status) on public.organization_invitations to authenticated;

-- ─── 4. approve_join_request: only a request the requester filed ───────────────
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

-- ─── 5. Mark the three policies with their fingerprint (read by step 0 on a re-run
--        and by the down script's precondition) ──────────────────────────────────
do $mark$
declare
  x record;
  v_sp text := current_setting('search_path');
begin
  perform set_config('search_path', 'public', true);
  for x in
    select p.tablename, p.policyname,
           md5(format('%s|%s|%s|%s|%s', p.permissive, p.cmd, p.roles, p.qual, p.with_check)) as fp
      from pg_policies p
     where p.schemaname = 'public'
       and (p.tablename, p.policyname) in (('organization_members', 'org_members_insert'),
                                          ('organization_invitations', 'owners_can_create_invitations'),
                                          ('organization_invitations', 'owners_can_update_invitations'))
  loop
    execute format('comment on policy %I on public.%I is %L',
                   x.policyname, x.tablename, 'org_members_no_forced_join ' || x.fp);
  end loop;
  perform set_config('search_path', v_sp, true);
end
$mark$;
