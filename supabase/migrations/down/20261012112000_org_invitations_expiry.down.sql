-- DOWN for supabase/migrations/20261012112000_org_invitations_expiry.sql.
-- Refused while 20261012113000_signup_identity_orgs is applied (its accept_org_invitation
-- refuses expired invitations: the onboarding pages must not offer them again). Puts back
-- check_pending_invitation (production md5 c384e225...) and approve_join_request
-- (6fb0ce33...), and unschedules the pg_cron job 'org-invitations-expire'. Invitations set to
-- 'expired' stay so (a status of the CHECK before and after).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
  v_row record;
begin
  if to_regprocedure('public.company_search(text,integer)') is not null then
    raise exception 'org_invitations_expiry DOWN: run the down of 20261012113000_signup_identity_orgs first';
  end if;
  for v_row in
    select * from (values
      ('public.check_pending_invitation(text)', 'c384e225cd6336fdeff22952526d2e65', '870eeb3c5741c0e5d2eb001991529509'),
      ('public.approve_join_request(uuid)', '6fb0ce33247218c832d738c97bb59f2d', 'ac9d150a92163841e383c7e80a5028b2')
    ) as x(sig, prod, mine)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_row.sig);
    if v_md5 is distinct from v_row.prod and v_md5 is distinct from v_row.mine then
      raise exception 'org_invitations_expiry DOWN: % changed since the up migration (md5 %); restore it by hand', v_row.sig, v_md5;
    end if;
  end loop;
end
$pre$;

select cron.unschedule(j.jobid) from cron.job j where j.jobname = 'org-invitations-expire';

-- Production bodies (CREATE OR REPLACE keeps owner and ACL).
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
