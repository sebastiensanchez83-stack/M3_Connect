-- DOWN for supabase/migrations/20261010200000_org_members_no_forced_join.sql
--
-- Puts back, exactly as they were in production on 10 Oct 2026:
--   * organization_members.org_members_insert (authenticated): WITH CHECK
--     is_org_owner(organization_id). The owner of a company may again insert ANY user;
--   * organization_invitations.owners_can_create_invitations (public): WITH CHECK owner
--     membership only (any e-mail, any status, any signature);
--   * organization_invitations.owners_can_update_invitations (public): USING owner
--     membership, no WITH CHECK;
--   * UPDATE on the whole organization_invitations table for anon and authenticated,
--     no column grant;
--   * approve_join_request: the production body (md5 7ba3768346ea5130dfe05ad115d3ef62),
--     which approves owner-written rows too.
-- The three policies lose the up file's fingerprint comment (they had none before).
-- That reopens both "forced member" paths the up file describes; use it only to undo the
-- fix if a legitimate flow turns out to need it. No data is touched.

-- ─── 0. Precondition: the up file's state (or already restored) ────────────────
do $pre$
declare
  v_md5 text;
  v_bad text;
  v_sp text := current_setting('search_path');
begin
  lock table public.organization_members, public.organization_invitations in access exclusive mode;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p
   where p.oid = 'public.approve_join_request(uuid)'::regprocedure;
  if v_md5 is distinct from '6fb0ce33247218c832d738c97bb59f2d'   -- the up file
     and v_md5 is distinct from '7ba3768346ea5130dfe05ad115d3ef62' then -- production before
    raise exception 'org_members_no_forced_join DOWN: approve_join_request changed since the up migration (md5 %); restore it by hand', v_md5;
  end if;

  -- Each policy is the up file's (its fingerprint comment still matches) or already the
  -- production one of 10 Oct 2026. Anything else was changed by someone since: stop.
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
    raise exception 'org_members_no_forced_join DOWN: policy % changed since the up migration; restore it by hand', v_bad;
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

-- ─── 3. organization_invitations grants ─────────────────────────────────────────
revoke update (status) on public.organization_invitations from authenticated;
grant update on public.organization_invitations to anon, authenticated;

-- ─── 4. approve_join_request: production body of 10 Oct 2026 ────────────────────
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
