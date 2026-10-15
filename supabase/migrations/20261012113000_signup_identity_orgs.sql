-- Unified registration, Phase 2 (DB lane), part 1 of 2: companies and teams.
-- Spec: regspec-en.md §3.9, §4.4-4.6; Victor 11 Oct 2026. Contract: docs/registration-contract.md "Phase 2".
-- NOT APPLIED. Apply after 20261009210000_registration_core and
-- 20261012112000_org_invitations_expiry (checked below), before 20261012113500_signup_identity
-- (part 2, which needs the statuses added here).
-- Down: supabase/migrations/down/20261012113000_signup_identity_orgs.down.sql.
-- Dry runs: supabase/dryrun/20261012113000_signup_identity_orgs.dryrun.sql, .dryrun2.sql (and .down.dryrun.sql).
--
-- For the live main site and for the redesign with every flag off, only these change:
--   * Decline on a join request works: status 'rejected' is allowed (reject_join_request
--     always wrote it; the CHECK refused it, error 23514). Both clients, both
--     send-notification versions and the InvitationStatus type already know 'rejected'.
--   * A claim code no longer makes anyone a member of a company that already has an
--     owner (claim_organization, claim_organization_for_user). Victor, 11 Oct 2026.
--   * accept_org_invitation refuses an invitation past its expires_at (30 days), and never
--     turns a suspended account into a verified one. The onboarding pages no longer offer an
--     expired invitation (20261012112000_org_invitations_expiry, applied first).
--   * An owner can no longer write an invitation that expires later than 30 days.
-- New, unused until the Phase 2 functions and pages call them: status 'claim_requested',
-- column code_matched, normalize_org_name + trigram index, company_search.
-- No /join/<token> table or RPC here (integration review, 15 Oct 2026): the team links are
-- signed by the edge functions ("SMC invite token v1", send-notification / accept-invite).
-- Not touched: reject_join_request, request_org_join, create_organization,
-- get_invitation_for_join (old /join/<id> links keep resolving; an expired row shows
-- "no longer valid" there).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---- 0. Preconditions --------------------------------------------------------
do $pre$
declare
  v_md5 text;
  v_def text;
  v_fp text;
  v_note text;
  v_sp text := current_setting('search_path');
  v_row record;
begin
  lock table public.organization_invitations in access exclusive mode;
  if to_regclass('public.review_log') is null or to_regprocedure('public.on_email_proven(uuid)') is null then
    raise exception 'signup_identity_orgs: apply 20261009210000_registration_core first';
  end if;
  -- accept_org_invitation below refuses an expired invitation: the onboarding pages must
  -- stop offering one first (20261012112000_org_invitations_expiry).
  if not exists (select 1 from cron.job j where j.jobname = 'org-invitations-expire') then
    raise exception 'signup_identity_orgs: apply 20261012112000_org_invitations_expiry first';
  end if;
  for v_row in
    select * from (values
      ('public.accept_org_invitation(uuid)', '40836bda218b0284d91a28f4d3d0c3c7', 'd2931bc02461e4f80fdda4aefa29fd41'),
      ('public.claim_organization(text)', '9e76262902c0ff2524c2134a13a99f57', 'c67aa88884d0494efe26c3ada41c8d8e'),
      ('public.claim_organization_for_user(uuid,text)', '03948e99491c8c9ce5472388f36f9c8a', 'da43fcccea2e39f0450347289da7d5e8'),
      -- not replaced: it must keep writing 'rejected', which step 2 allows
      ('public.reject_join_request(uuid)', '8b8efcc5956f01847e4983ca8202a50e', '8b8efcc5956f01847e4983ca8202a50e')
    ) as x(sig, prod, mine)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_row.sig);
    if v_md5 is distinct from v_row.prod and v_md5 is distinct from v_row.mine then
      raise exception 'signup_identity_orgs: % changed (md5 %); rebuild this migration from pg_get_functiondef', v_row.sig, v_md5;
    end if;
  end loop;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.organization_invitations'::regclass and c.conname = 'organization_invitations_status_check';
  if v_def is distinct from 'CHECK ((status = ANY (ARRAY[''pending''::text, ''accepted''::text, ''expired''::text, ''cancelled''::text, ''join_requested''::text])))'
     and v_def is distinct from 'CHECK ((status = ANY (ARRAY[''pending''::text, ''accepted''::text, ''expired''::text, ''cancelled''::text, ''join_requested''::text, ''rejected''::text, ''claim_requested''::text])))' then
    raise exception 'signup_identity_orgs: organization_invitations_status_check is %', v_def;
  end if;
  -- owners_can_create_invitations: the one of 20261011083257 (fingerprint 3cd3e879...) or this file's.
  perform set_config('search_path', 'public', true);
  select md5(format('%s|%s|%s|%s|%s', p.permissive, p.cmd, p.roles, p.qual, p.with_check)), obj_description(pp.oid, 'pg_policy')
    into v_fp, v_note
    from pg_policies p
    join pg_policy pp on pp.polrelid = 'public.organization_invitations'::regclass and pp.polname = p.policyname
   where p.schemaname = 'public' and p.tablename = 'organization_invitations' and p.policyname = 'owners_can_create_invitations';
  perform set_config('search_path', v_sp, true);
  if not ((v_fp = '3cd3e879f8c5dba7a69ba174c5d77276' and v_note = 'org_members_no_forced_join ' || v_fp)
          or v_note = 'signup_identity ' || v_fp) then
    raise exception 'signup_identity_orgs: owners_can_create_invitations is not the policy of 20261011083257 (fingerprint %, note %)', v_fp, v_note;
  end if;
end
$pre$;

-- ---- 1. Company-name matching -------------------------------------------------
-- SQL-standard bodies: bound to unaccent and to each other by OID (as smc_fold), so the
-- IMMUTABLE label holds while unaccent's rules stay the same. After a Postgres major
-- upgrade or ALTER EXTENSION unaccent UPDATE: REINDEX INDEX public.organizations_name_norm_trgm_idx.
create or replace function public.immutable_unaccent(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path to ''
return public.unaccent('public.unaccent'::regdictionary, p);

-- lower case, accents off, dots dropped (s.a.r.l. -> sarl, d.o.o. -> doo), other
-- punctuation -> space, legal-form SUFFIXES dropped (spec: never at the start, where
-- 'Spa Resorts SpA' or 'SA Monaco ...' would lose a real word), spaces collapsed; NULL
-- when nothing is left. 'sam' (Monaco's S.A.M.) is added to the spec's list.
create or replace function public.normalize_org_name(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path to ''
return nullif(pg_catalog.btrim(pg_catalog.regexp_replace(
  pg_catalog.regexp_replace(
    pg_catalog.btrim(pg_catalog.regexp_replace(
      pg_catalog.replace(pg_catalog.lower(public.immutable_unaccent(pg_catalog.normalize(p, 'NFD'))), '.', ''),
      '[^[:alnum:]]+', ' ', 'g')),
    '( (sas|sarl|sa|sam|ltd|llc|inc|gmbh|srl|spa|bv|doo))+$', ''),
  ' +', ' ', 'g')), '');

grant execute on function public.immutable_unaccent(text) to anon, authenticated, service_role;
grant execute on function public.normalize_org_name(text) to anon, authenticated, service_role;

create index if not exists organizations_name_norm_trgm_idx
  on public.organizations using gin (public.normalize_org_name(name) extensions.gin_trgm_ops);

-- ---- 2. organization_invitations ----------------------------------------------
alter table public.organization_invitations
  add column if not exists code_matched boolean not null default false;
alter table public.organization_invitations drop constraint if exists organization_invitations_status_check;
alter table public.organization_invitations add constraint organization_invitations_status_check
  check (status = any (array['pending', 'accepted', 'expired', 'cancelled', 'join_requested', 'rejected', 'claim_requested']));
alter table public.organization_invitations drop constraint if exists organization_invitations_code_matched_check;
alter table public.organization_invitations add constraint organization_invitations_code_matched_check
  check (not code_matched or status not in ('pending', 'join_requested'));
comment on column public.organization_invitations.code_matched is
  'claim_requested rows: the person typed the company''s claim code. M3 still decides every claim (Victor, 11 Oct 2026).';

-- 20261011083257's policy (owner, 'pending', signed by the caller) + an expiry cap. Owners
-- never set expires_at (default now() + 30 days, the same now() as here).
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
    and expires_at <= now() + interval '30 days'
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
  execute format('comment on policy owners_can_create_invitations on public.organization_invitations is %L', 'signup_identity ' || v_fp);
  perform set_config('search_path', v_sp, true);
end
$mark$;

-- ---- 3. accept_org_invitation -------------------------------------------------
-- Production body (md5 40836bda...) plus the expiry check and "never un-suspend", both
-- marked 12 Oct 2026. Signature, owner and ACL unchanged (CREATE OR REPLACE keeps them).
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

  SELECT oi.id, oi.organization_id, oi.email, oi.status, oi.expires_at
    INTO v_invitation FROM organization_invitations oi WHERE oi.id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending (current status: %)', v_invitation.status;
  END IF;
  -- 12 Oct 2026: an invitation is valid until expires_at (30 days after it was sent).
  IF v_invitation.expires_at < now() THEN
    RAISE EXCEPTION 'This invitation has expired. Ask the person who invited you to send a new one.';
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
    -- 12 Oct 2026: a suspended account stays suspended.
    UPDATE profiles SET access_status='verified', onboarding_status='completed', updated_at=now()
     WHERE user_id = auth.uid() AND access_status <> 'suspended';
  ELSE
    UPDATE profiles SET onboarding_status='submitted', updated_at=now()
     WHERE user_id = auth.uid() AND access_status <> 'verified';
  END IF;
END;
$function$;

-- ---- 4. Claim codes: refused once the company has an owner (Victor, 11 Oct 2026) --
-- Production body (md5 9e762629...): an owner of record now counts as an owner, and the
-- refusal is marked 12 Oct 2026. A company with no owner: unchanged on the old client
-- (held/signup_identity_golive.sql revokes this function; the new sign-up files a
-- claim_requested that M3 decides).
CREATE OR REPLACE FUNCTION public.claim_organization(p_claim_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select id, name, access_status, organization_type, owner_user_id into v_org
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
                where organization_id = v_org.id and role = 'owner')
         or v_org.owner_user_id is not null into v_has_owner;
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
    -- 12 Oct 2026: a claim code never makes anyone a member of a company that already
    -- has an owner; the owner invites their team.
    if v_has_owner then
      raise exception 'This company already has an owner on Smart Marina Connect. Ask them to invite you to the team.';
    end if;
    v_role := 'owner';
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

-- Production body (md5 03948e99...) with the same rule; a member's retry is unchanged.
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

  select id, name, access_status, organization_type, owner_user_id into v_org
  from organizations
  where upper(trim(claim_code)) = upper(trim(p_claim_code)) and claim_code is not null;
  if not found then raise exception 'Invalid organization code'; end if;

  select exists(select 1 from organization_members
                where organization_id = v_org.id and role = 'owner')
         or v_org.owner_user_id is not null into v_has_owner;
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
    -- 12 Oct 2026: never a member of a company that already has an owner.
    if v_has_owner then
      raise exception 'This company already has an owner on Smart Marina Connect. Ask them to invite you to the team.';
    end if;
    v_role := 'owner';
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

-- ---- 5. Company search (service role: account-signup company_search) -------------
-- Public card fields only (no owner, no members, no claim code), at most 8 rows. Verified
-- and pending companies; archived / duplicate ones (Phase 3 columns, read through to_jsonb
-- so this works before they exist) are left out.
create or replace function public.company_search(p_q text, p_limit integer default 8)
returns table (id uuid, name text, logo_url text, city text, country text, organization_type text, verified boolean)
language sql
stable
security definer
set search_path = ''
as $function$
  with q as (select public.normalize_org_name(left(p_q, 100)) as n)
  select o.id, o.name, o.logo_url, o.city, coalesce(o.country, o.headquarters_country), o.organization_type,
         o.access_status = 'verified'
    from public.organizations o, q
   where char_length(btrim(coalesce(p_q, ''))) >= 3
     and q.n is not null
     and o.access_status in ('verified', 'pending')
     and (to_jsonb(o) ->> 'archived_at') is null
     and (to_jsonb(o) ->> 'duplicate_of') is null
     and (public.normalize_org_name(o.name) operator(extensions.%) q.n
          or public.normalize_org_name(o.name) like '%' || q.n || '%')
   order by (public.normalize_org_name(o.name) = q.n) desc,
            extensions.similarity(public.normalize_org_name(o.name), q.n) desc, o.name
   limit least(greatest(coalesce(p_limit, 8), 1), 8)
$function$;

-- ---- 6. EXECUTE -----------------------------------------------------------------
revoke all on function public.company_search(text, integer) from public, anon, authenticated;
grant execute on function public.company_search(text, integer) to service_role;
