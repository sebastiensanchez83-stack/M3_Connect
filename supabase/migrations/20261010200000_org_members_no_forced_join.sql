-- Nobody can make SOMEONE ELSE a member of a company without that person's consent or
-- M3 staff (security fix, 10 Oct 2026; workstream 12 of chantiers-en-cours).
--
-- NOT APPLIED. Written on branch rf-sec. Down script:
-- supabase/migrations/down/20261010200000_org_members_no_forced_join.down.sql. Dry run:
-- supabase/dryrun/20261010200000_org_members_no_forced_join.dryrun.sql (run it first, in
-- ONE execute_sql call; every line must say PASS).
-- Supersedes the unreviewed draft "org_members_insert_self_only" (stash on rf-msg), which
-- left the forged-join-request path below open.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- 1. organization_members.org_members_insert was WITH CHECK is_org_owner(organization_id)
--    only. Any signed-in account can own a company (create_organization, or a direct
--    INSERT through org_insert), so the owner of a made-up company could insert ANY user
--    id, with role 'owner' or 'collaborator'. Membership is what "speaks for and reads
--    for" a company:
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
--  Direct client INSERTs: none live. OnboardingPage (main and refonte) still has two
--    inserts of the user themself into a "detected" company, but detectedOrg is only
--    set from an existing join request and never carries auto_approve, so both are
--    dead code, and they were already refused since 6 Oct
--    (20261006174500_org_membership_trusts_verified_auth_email_only.sql).
--  Team invitations (both clients): the owner INSERTs a 'pending' invitation with
--    invited_by_user_id = themself and may set it to 'cancelled'; nothing else.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What changes
-- ════════════════════════════════════════════════════════════════════════════
-- 1. org_members_insert (authenticated). A direct INSERT is allowed only for
--      - the company's owner of record (organizations.owner_user_id, which
--        guard_org_sensitive_columns keeps out of self-service reach) adding THEMSELF
--        with role 'owner' (the bootstrap after a direct organizations INSERT); or
--      - a verified admin / moderator (is_moderator()), like org_update.
--    Everyone else goes through the RPCs above. Requiring role 'owner' on the self
--    branch keeps "an owner row is the owner of record" true (114/114 owner rows match
--    today; send-notification relies on it).
-- 2. owners_can_create_invitations (public): same owner check, plus status 'pending'
--    and invited_by_user_id = auth.uid().
--    owners_can_update_invitations (public): same USING, plus a WITH CHECK: the row
--    stays the caller's company's and its status ends 'pending' or 'cancelled'.
--    So an owner can no longer write a 'join_requested' (or 'accepted') row.
-- 3. approve_join_request: refuses a row with invited_by_user_id set (an owner-written
--    invitation is accepted by the invitee, never "approved" by the owner). Defence in
--    depth for any row forged before this migration; production had no join request at
--    all on 10 Oct 2026 (7 invitations, all signed by the owner or staff member who
--    sent them: 5 accepted, 1 pending, 1 cancelled).
--
-- organization_members UPDATE: there is NO update policy, so a direct UPDATE changes no
-- row (a member cannot promote themself, an owner cannot rewrite someone's row).
-- organizations.owner_user_id is frozen for self-service by guard_org_sensitive_columns.
-- Left as they are; the dry run proves both.
--
-- Existing rows (read-only, 10 Oct 2026; nothing here changes them): 136 memberships.
--   114 owner rows, all equal to organizations.owner_user_id (no forced owner row).
--   22 collaborator rows: 19 have a trace (16 SM26 roster/registration of that company,
--   2 accepted invitations, 1 creator who later handed the company over); 3 have no
--   invitation, claim, creation, SM26, sponsor or audit-log trace. All 3 joined in July
--   2026, before company messaging existed, in companies and profiles M3 had verified.
--   Their ids are in the lane report, not in this public file.
--
-- Unchanged: org_members_delete, org_members_select_*, the other invitation policies,
-- every RPC except approve_join_request, the table grants. No data is touched.
-- Old live client (main): its team invite (pending insert, cancel), accept, approve,
-- create and claim flows pass exactly as before. Idempotent: policies are dropped and
-- recreated; the function precondition accepts the reviewed or the patched body.
--
-- Check after applying (read-only):
--   select policyname, cmd, roles, qual, with_check from pg_policies
--    where schemaname = 'public'
--      and tablename in ('organization_members', 'organization_invitations')
--    order by tablename, policyname;
--     org_members_insert            -> with_check mentions is_org_owner, auth.uid(),
--                                      'owner'::text and is_moderator()
--     owners_can_create_invitations -> with_check mentions 'pending'::text and
--                                      invited_by_user_id
--     owners_can_update_invitations -> with_check mentions 'cancelled'::text
--   select md5(prosrc) from pg_proc where oid = 'public.approve_join_request(uuid)'::regprocedure;
--     -> 6fb0ce33247218c832d738c97bb59f2d (the body below)

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
