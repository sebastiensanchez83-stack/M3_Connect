-- Organization membership must trust the VERIFIED sign-in e-mail, never profiles.email,
-- and domain auto-join is switched off at the database.
--
-- The hole. profiles.email is an ordinary column the user can rewrite on their
-- own row (profiles_update_own_or_moderator + table-level UPDATE grant), and it is
-- never verified. can_domain_join() matched the e-mail domain against
-- profiles.email, and can_domain_join() is the whole gate of the RLS policy
-- organization_members.org_members_insert. So any signed-in user could
--   update profiles set email = 'ceo@some-marina.com' where user_id = auth.uid();
--   insert into organization_members (organization_id, user_id, role)
--     values ('<some-marina org id>', auth.uid(), 'collaborator');
-- and sit inside any organization with auto_approve_domain_joins = true (10 orgs
-- at the time of writing), seeing its members, invitations, private documents
-- (storage policy org_documents_select_members) and other member-only data.
--
-- The fix, part 1: domain auto-join is closed at the RLS gate. The policy
-- organization_members.org_members_insert loses its self-insert branch
--   (auth.uid() = user_id AND role = 'collaborator' AND can_domain_join(organization_id))
-- and keeps only is_org_owner(organization_id). A verified-address check alone is
-- not enough here: Auth "Confirm email" is OFF on this project (see CAVEAT), so
-- anyone can sign up as unused-address@some-marina.com, get a confirmed session at
-- once and self-insert. Nothing is lost by closing it:
--   - the UI never reaches the self-insert: OnboardingPage only sets detectedOrg
--     from an existing join request and never sets auto_approve, so its two
--     auto-join handlers are dead code;
--   - every other membership write goes through a SECURITY DEFINER function owned
--     by postgres (create_organization, accept_org_invitation, approve_join_request,
--     claim_organization, claim_organization_for_user, admin_add_org_member) or an
--     edge function on the service role, none of which is subject to this policy;
--   - no organization with auto_approve_domain_joins = true has a single
--     collaborator today, so nobody ever joined this way.
-- The owner's "Auto-approve" switch in the organization tab does nothing from now
-- on. If domain auto-join is ever wanted back, rebuild it as a SECURITY DEFINER
-- RPC with a server-side seat check, and only once "Confirm email" is on; do not
-- just restore the old policy branch.
--
-- The fix, part 2. Every function below now reads the caller's e-mail from
-- auth.users (id = auth.uid()) and requires auth.users.email_confirmed_at IS NOT
-- NULL before any domain match, auto-join, join request or invitation acceptance:
--   * can_domain_join(uuid)            -- profiles.email -> verified auth.users.email.
--                                         No policy uses it after part 1; it keeps the
--                                         corrected body so that wiring it back in can
--                                         never reopen the profiles.email hole.
--   * current_user_email()             -- now NULL until the address is confirmed;
--                                         only consumer is the RLS policy
--                                         organization_invitations.invitees_can_view_own_invitation
--   * check_pending_invitation(text)   -- p_email is IGNORED (signature kept for the
--                                         existing caller); always looks up the
--                                         caller's own verified address. Drops the
--                                         moderator branch that let a moderator probe
--                                         any address (no caller uses it).
--   * accept_org_invitation(uuid)      -- already used auth.users.email; now also
--                                         refuses an unconfirmed address
--   * request_org_join(uuid)           -- same
--   * approve_join_request(uuid)       -- the requester is resolved only among
--                                         accounts whose address is confirmed
-- Not changed (audited, no e-mail trust): reject_join_request, claim_organization
-- (claim code), create_organization (no e-mail involved, although it does not
-- check primary_domain against the owner's address), get_invitation_for_join
-- (lookup by secret invitation id).
--
-- CAVEAT, read before relying on part 2. On this project every account created via
-- supabase.auth.signUp since May 2026 got email_confirmed_at within seconds of
-- created_at and no confirmation_sent_at, i.e. Auth > Email > "Confirm email" is
-- OFF (auto-confirm). While it stays off, email_confirmed_at is set at signup AND a
-- user's own e-mail change applies immediately, so it proves nothing. Domain
-- auto-join is closed whatever that setting is (part 1). What stays open until
-- "Confirm email" and "Secure email change" are turned on in the dashboard:
-- someone can sign up with the exact address of a pending invitation the real
-- invitee has not used yet, then see and accept it; and a join request carries
-- whatever address the requester signed up with (the owner still sees that
-- address and must approve it). Part 2 closes the profiles.email path for good
-- and makes these checks correct the moment those settings are on.
--
-- CREATE OR REPLACE keeps each function's owner, ACL and grants, so none are
-- restated. Signatures, return types, language, volatility, SECURITY DEFINER and
-- search_path are unchanged. The policy is recreated with its existing name,
-- command (INSERT) and role (authenticated).

-- ─── can_domain_join ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_domain_join(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.organizations o
    join auth.users u on u.id = auth.uid()
    where o.id = p_org_id
      and o.auto_approve_domain_joins = true
      and o.primary_domain is not null
      and u.email is not null
      and u.email_confirmed_at is not null
      and lower(split_part(u.email, '@', 2)) = lower(o.primary_domain)
  );
$function$;

-- ─── org_members_insert: owners only, no domain self-insert (part 1) ─────────
-- Was: is_org_owner(organization_id)
--      OR ((select auth.uid()) = user_id AND role = 'collaborator'
--          AND can_domain_join(organization_id))
drop policy if exists org_members_insert on public.organization_members;

create policy org_members_insert on public.organization_members
  for insert to authenticated
  with check (is_org_owner(organization_id));

-- ─── current_user_email ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_email()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select u.email::text from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;
$function$;

-- ─── check_pending_invitation ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_pending_invitation(p_email text)
 RETURNS TABLE(invitation_id uuid, organization_id uuid, organization_name text, invited_by_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
begin
  -- p_email is ignored on purpose: the only address anyone may look up is their
  -- own, verified sign-in address. The parameter stays for existing callers.
  if auth.uid() is null then
    raise exception 'Not authorized';
  end if;
  select u.email into v_email from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;
  if btrim(coalesce(v_email, '')) = '' then
    return;
  end if;
  return query
    select oi.id, oi.organization_id, o.name,
           coalesce(p.first_name || ' ' || p.last_name, 'Unknown')
    from organization_invitations oi
    join organizations o on o.id = oi.organization_id
    left join profiles p on p.user_id = oi.invited_by_user_id
    where lower(oi.email) = lower(v_email) and oi.status = 'pending';
end;
$function$;

-- ─── accept_org_invitation ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invitation   RECORD;
  v_user_email   TEXT;
  v_confirmed    BOOLEAN;
  v_org_verified BOOLEAN;
BEGIN
  SELECT email, (email_confirmed_at IS NOT NULL) INTO v_user_email, v_confirmed
    FROM auth.users WHERE id = auth.uid();
  IF v_user_email IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT v_confirmed THEN
    RAISE EXCEPTION 'Please confirm your email address before joining an organization';
  END IF;

  SELECT oi.id, oi.organization_id, oi.email, oi.status
    INTO v_invitation FROM organization_invitations oi WHERE oi.id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending (current status: %)', v_invitation.status;
  END IF;
  IF lower(v_user_email) <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'Your email does not match this invitation';
  END IF;

  UPDATE organization_invitations SET status = 'accepted' WHERE id = p_invitation_id;
  INSERT INTO organization_members (user_id, organization_id, role)
  VALUES (auth.uid(), v_invitation.organization_id, 'collaborator')
  ON CONFLICT DO NOTHING;

  SELECT (o.access_status = 'verified') INTO v_org_verified
    FROM organizations o WHERE o.id = v_invitation.organization_id;

  IF v_org_verified THEN
    UPDATE profiles SET access_status='verified', onboarding_status='completed', updated_at=now()
     WHERE user_id = auth.uid();
  ELSE
    UPDATE profiles SET onboarding_status='submitted', updated_at=now()
     WHERE user_id = auth.uid() AND access_status <> 'verified';
  END IF;
END;
$function$;

-- ─── request_org_join ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_org_join(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_email  TEXT;
  v_confirmed   BOOLEAN;
  v_first_name  TEXT;
  v_last_name   TEXT;
  v_existing    UUID;
BEGIN
  -- Get calling user's email (the verified sign-in address, never profiles.email)
  SELECT email, (email_confirmed_at IS NOT NULL)
    INTO v_user_email, v_confirmed
    FROM auth.users
   WHERE id = auth.uid();

  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT v_confirmed THEN
    RAISE EXCEPTION 'Please confirm your email address before requesting to join an organization';
  END IF;

  -- Verify the organization exists
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  -- Check for an existing pending or join_requested row for this email + org
  SELECT oi.id INTO v_existing
    FROM organization_invitations oi
   WHERE lower(oi.email) = lower(v_user_email)
     AND oi.organization_id = p_organization_id
     AND oi.status IN ('pending', 'join_requested');

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'A request or invitation already exists for this email and organization';
  END IF;

  -- Get the user's name from their profile
  SELECT p.first_name, p.last_name
    INTO v_first_name, v_last_name
    FROM profiles p
   WHERE p.user_id = auth.uid();

  -- Create the join request (invited_by_user_id is NULL for self-requests)
  INSERT INTO organization_invitations (
    organization_id,
    email,
    first_name,
    last_name,
    status,
    invited_by_user_id
  ) VALUES (
    p_organization_id,
    v_user_email,
    v_first_name,
    v_last_name,
    'join_requested',
    NULL
  );
END;
$function$;

-- ─── approve_join_request ─────────────────────────────────────────────────────
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
