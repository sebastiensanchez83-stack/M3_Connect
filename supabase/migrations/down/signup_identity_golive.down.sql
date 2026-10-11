-- DOWN for supabase/migrations/held/signup_identity_golive.sql: the EXECUTE grants of
-- before and the request_org_join body of before (production md5 966803f3...).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.request_org_join(uuid)');
  if v_md5 is distinct from '966803f30484c2bf363c925bd77f1f63' and v_md5 is distinct from '06ff2f219deb4b7cf7332bb61ea8a0a6' then
    raise exception 'signup_identity_golive DOWN: request_org_join changed since (md5 %); restore it by hand', v_md5;
  end if;
end
$pre$;

grant execute on function public.create_organization(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.claim_organization(text) to public, anon, authenticated;

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
