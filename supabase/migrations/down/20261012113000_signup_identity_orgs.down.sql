-- DOWN for supabase/migrations/20261012113000_signup_identity_orgs.sql (part 1 of 2).
-- Run the down of 20261012113500_signup_identity (part 2) FIRST (checked below).
-- Puts back, exactly as in production before part 1: accept_org_invitation (md5 40836bda...),
-- claim_organization (9e762629...), claim_organization_for_user (03948e99...), the status
-- CHECK (5 statuses), owners_can_create_invitations of 20261011083257 (fingerprint
-- 3cd3e879..., with its 'org_members_no_forced_join <fp>' note, so that migration's own down
-- still recognises it). Drops code_matched, org_invitation_token (live /join/<token> links
-- stop working; old /join/<id> links keep working), the org_invitation_* functions,
-- accept_org_invitation_for / _by_token, company_search, the trigram index,
-- normalize_org_name and immutable_unaccent.
-- Data: rows in a status the old CHECK refuses are set to 'cancelled' first (a declined join
-- request 'rejected', an open claim 'claim_requested'); the counts are printed (NOTICE).
-- expires_at moved forward by org_invitation_issue_token stays as it is.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
  v_fp text;
  v_note text;
  v_sp text := current_setting('search_path');
  v_row record;
begin
  lock table public.organization_invitations in access exclusive mode;
  if to_regprocedure('public.confirm_email_proof(text)') is not null then
    raise exception 'signup_identity_orgs DOWN: run the down of 20261012113500_signup_identity first';
  end if;
  for v_row in
    select * from (values
      ('public.accept_org_invitation(uuid)', '40836bda218b0284d91a28f4d3d0c3c7', 'd2931bc02461e4f80fdda4aefa29fd41'),
      ('public.claim_organization(text)', '9e76262902c0ff2524c2134a13a99f57', 'c67aa88884d0494efe26c3ada41c8d8e'),
      ('public.claim_organization_for_user(uuid,text)', '03948e99491c8c9ce5472388f36f9c8a', 'da43fcccea2e39f0450347289da7d5e8')
    ) as x(sig, prod, mine)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_row.sig);
    if v_md5 is distinct from v_row.prod and v_md5 is distinct from v_row.mine then
      raise exception 'signup_identity_orgs DOWN: % changed since the up migration (md5 %); restore it by hand', v_row.sig, v_md5;
    end if;
  end loop;
  perform set_config('search_path', 'public', true);
  select md5(format('%s|%s|%s|%s|%s', p.permissive, p.cmd, p.roles, p.qual, p.with_check)), obj_description(pp.oid, 'pg_policy')
    into v_fp, v_note
    from pg_policies p
    join pg_policy pp on pp.polrelid = 'public.organization_invitations'::regclass and pp.polname = p.policyname
   where p.schemaname = 'public' and p.tablename = 'organization_invitations' and p.policyname = 'owners_can_create_invitations';
  perform set_config('search_path', v_sp, true);
  if not (v_note = 'signup_identity ' || v_fp
          or (v_fp = '3cd3e879f8c5dba7a69ba174c5d77276' and v_note = 'org_members_no_forced_join ' || v_fp)) then
    raise exception 'signup_identity_orgs DOWN: owners_can_create_invitations changed since the up migration (fingerprint %); restore it by hand', v_fp;
  end if;
end
$pre$;

do $rows$
declare
  v_rej integer;
  v_claim integer;
begin
  update public.organization_invitations set status = 'cancelled' where status = 'rejected';
  get diagnostics v_rej = row_count;
  update public.organization_invitations set status = 'cancelled' where status = 'claim_requested';
  get diagnostics v_claim = row_count;
  raise notice 'signup_identity_orgs DOWN: % declined join request(s) and % claim request(s) set to cancelled', v_rej, v_claim;
end
$rows$;

alter table public.organization_invitations drop constraint if exists organization_invitations_code_matched_check;
alter table public.organization_invitations drop column if exists code_matched;
alter table public.organization_invitations drop constraint if exists organization_invitations_status_check;
alter table public.organization_invitations add constraint organization_invitations_status_check
  check (status = any (array['pending'::text, 'accepted'::text, 'expired'::text, 'cancelled'::text, 'join_requested'::text]));

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
do $mark$
declare
  v_sp text := current_setting('search_path');
  v_fp text;
begin
  perform set_config('search_path', 'public', true);
  select md5(format('%s|%s|%s|%s|%s', p.permissive, p.cmd, p.roles, p.qual, p.with_check)) into v_fp
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'organization_invitations' and p.policyname = 'owners_can_create_invitations';
  execute format('comment on policy owners_can_create_invitations on public.organization_invitations is %L', 'org_members_no_forced_join ' || v_fp);
  perform set_config('search_path', v_sp, true);
end
$mark$;

-- Production bodies (CREATE OR REPLACE keeps owner and ACL).
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

create or replace function public.claim_organization(p_claim_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org record;
  v_user_id uuid;
  v_existing boolean;
  v_has_owner boolean;
  v_role text;
  v_fails int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  -- Throttle (audit S2): at most 10 failed codes per user per rolling hour.
  -- The lock serialises this user's concurrent calls until commit, so each one
  -- counts the failures the previous ones recorded.
  perform pg_advisory_xact_lock(hashtextextended('org_claim_attempt:' || v_user_id::text, 0));
  select count(*) into v_fails
    from org_claim_attempt
   where user_id = v_user_id
     and attempted_at > now() - interval '1 hour';
  if v_fails >= 10 then
    raise exception 'Too many attempts. Please wait an hour and try again.';
  end if;

  select id, name, access_status, organization_type into v_org
  from organizations
  where upper(trim(claim_code)) = upper(trim(p_claim_code)) and claim_code is not null;
  if not found then
    if coalesce(current_setting('request.method', true), '') = ''
       and coalesce(current_setting('request.headers', true), '') = '' then
      -- Not an API request: keep the historical contract (a RAISE). Nothing
      -- could be recorded anyway, the RAISE rolls the transaction back.
      raise exception 'Invalid organization code';
    end if;
    -- API request: record the failure and answer exactly what PostgREST sends
    -- for a RAISE (HTTP 400, same JSON error body), without rolling back.
    insert into org_claim_attempt (user_id) values (v_user_id);
    delete from org_claim_attempt
     where user_id = v_user_id
       and attempted_at < now() - interval '1 day';
    perform set_config('response.status', '400', true);
    return jsonb_build_object(
      'code', 'P0001',
      'message', 'Invalid organization code',
      'details', null,
      'hint', null
    );
  end if;

  select exists(select 1 from organization_members
                where organization_id = v_org.id and role = 'owner') into v_has_owner;
  select exists(select 1 from organization_members
                where user_id = v_user_id and organization_id = v_org.id) into v_existing;

  if v_existing then
    -- Already a member. Only a genuine no-op deserves an error: if somebody
    -- already owns this organization there is nothing left to claim.
    if v_has_owner then
      raise exception 'You are already a member of this organization';
    end if;
    update organization_members set role = 'owner'
      where organization_id = v_org.id and user_id = v_user_id;
    v_role := 'owner';
  else
    v_role := case when v_has_owner then 'collaborator' else 'owner' end;
    insert into organization_members (user_id, organization_id, role)
    values (v_user_id, v_org.id, v_role);
  end if;

  -- Owner of record (fixes the null owner_user_id -> broken connect flow).
  if v_role = 'owner' then
    update organizations set owner_user_id = v_user_id
    where id = v_org.id and owner_user_id is null;
  end if;

  if v_org.access_status = 'verified' then
    update profiles
    set access_status = 'verified', onboarding_status = 'completed',
        persona = v_org.organization_type::persona_enum, updated_at = now()
    where user_id = v_user_id;
  end if;

  return jsonb_build_object('organization_id', v_org.id,
                            'organization_name', v_org.name, 'role', v_role);
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_organization_for_user(p_user_id uuid, p_claim_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org record;
  v_existing boolean;
  v_has_owner boolean;
  v_role text;
begin
  if p_user_id is null then raise exception 'user_id required'; end if;

  select id, name, access_status, organization_type into v_org
  from organizations
  where upper(trim(claim_code)) = upper(trim(p_claim_code)) and claim_code is not null;
  if not found then raise exception 'Invalid organization code'; end if;

  select exists(select 1 from organization_members
                where organization_id = v_org.id and role = 'owner') into v_has_owner;
  select exists(select 1 from organization_members
                where user_id = p_user_id and organization_id = v_org.id) into v_existing;

  if v_existing then
    -- Already a member (e.g. a retry). Promote to owner only if the org has none.
    if not v_has_owner then
      update organization_members set role = 'owner'
        where organization_id = v_org.id and user_id = p_user_id;
      v_role := 'owner';
    else
      select role into v_role from organization_members
        where organization_id = v_org.id and user_id = p_user_id;
    end if;
  else
    v_role := case when v_has_owner then 'collaborator' else 'owner' end;
    insert into organization_members (user_id, organization_id, role)
    values (p_user_id, v_org.id, v_role);
  end if;

  if v_role = 'owner' then
    update organizations set owner_user_id = p_user_id
    where id = v_org.id and owner_user_id is null;
  end if;

  if v_org.access_status = 'verified' then
    update profiles
    set access_status = 'verified', onboarding_status = 'completed',
        persona = v_org.organization_type::persona_enum, updated_at = now()
    where user_id = p_user_id;
  end if;

  return jsonb_build_object('organization_id', v_org.id,
                            'organization_name', v_org.name, 'role', v_role);
end;
$function$;

drop function if exists public.company_search(text, integer);
drop function if exists public.accept_org_invitation_by_token(text);
drop function if exists public.accept_org_invitation_for(uuid, text);
drop function if exists public.org_invitation_by_token(text);
drop function if exists public.org_invitation_issue_token(uuid);
drop function if exists public.org_invitation_resolve(text);
drop table if exists public.org_invitation_token;
drop index if exists public.organizations_name_norm_trgm_idx;
drop function if exists public.normalize_org_name(text);
drop function if exists public.immutable_unaccent(text);
