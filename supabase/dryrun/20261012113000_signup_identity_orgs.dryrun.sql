-- DRY RUN of supabase/migrations/20261012113000_signup_identity_orgs.sql. NOT A MIGRATION.
-- Run it as ONE query text in ONE execute_sql call, after 20261012112000_org_invitations_expiry
-- is applied. It ends with RAISE EXCEPTION 'DRYRUN ...': the report is the error message and
-- everything rolls back (the migration, test people, companies, invitations).
-- A. snapshot; B. the migration verbatim; C. helpers; D. checks and cases, each case in its
-- own sub-transaction (setup as postgres, the statement as the caller: set local role
-- anon / authenticated / service_role + request.jwt.claims, chk as postgres), rolled back
-- before the next one. Test people and companies are made per case (example.invalid
-- addresses, random ids and codes): no personal data in this file.
-- Expectations: allow = no error (>= 1 row for a write); rls = 42501 or 0 rows written;
-- err:<text> = an error containing <text>; ret:<v> = returned exactly <v>; chk must be true.
-- S05 compares SM26, gl_guest, invitations, companies, members, profiles, policies and ACLs
-- before/after: a concurrent write by a real user shows there as a FAIL; re-run then.
-- More cases: dry run 2 (claim codes, company_search).
-- It holds an ACCESS EXCLUSIVE lock on organization_invitations until the final rollback
-- (a few seconds): run it off-peak.
-- Expected: "19 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot (read again after the migration: must be identical) ─────────
-- A pending invitation past its expiry is read as 'expired' (part 1 sets it so).
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'acl ' || p.oid::regprocedure::text, coalesce(p.proacl::text, '') || ' ' || pg_get_userbyid(p.proowner)
    from pg_proc p
   where p.oid in ('public.accept_org_invitation(uuid)'::regprocedure, 'public.claim_organization(text)'::regprocedure,
                   'public.claim_organization_for_user(uuid,text)'::regprocedure, 'public.reject_join_request(uuid)'::regprocedure,
                   'public.approve_join_request(uuid)'::regprocedure, 'public.check_pending_invitation(text)'::regprocedure, 'public.handle_new_user()'::regprocedure,
                   'public.complete_signup_for(uuid)'::regprocedure, 'public.request_org_join(uuid)'::regprocedure,
                   'public.create_organization(text,text,text,text,text,text,text)'::regprocedure)
  union all select 'sm26', md5(concat_ws('|',
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_registration x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_role_assignment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_attendee x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_badge x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_payment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_invoice x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_networking_pass x)))
  union all select 'gl_guest', (select md5(coalesce(string_agg(g.id::text || g.token::text || g.status, ',' order by g.id), '')) from public.gl_guest g)
  union all select 'invitations', (select md5(coalesce(string_agg(i.id::text || case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end || i.email || i.expires_at::text, ',' order by i.id), '')) from public.organization_invitations i)
  union all select 'orgs', (select md5(coalesce(string_agg(o.id::text || o.name || coalesce(o.access_status, '') || coalesce(o.owner_user_id::text, ''), ',' order by o.id), '')) from public.organizations o)
  union all select 'members', (select md5(coalesce(string_agg(m.id::text || m.user_id::text || m.role, ',' order by m.id), '')) from public.organization_members m)
  union all select 'profiles', (select md5(coalesce(string_agg(pr.user_id::text || pr.access_status::text || pr.onboarding_status::text || pr.persona::text || pr.updated_at::text, ',' order by pr.user_id), '')) from public.profiles pr)
  union all select 'other_policies', (select md5(string_agg(format('%s|%s|%s|%s|%s', pl.tablename, pl.policyname, pl.cmd, pl.qual, pl.with_check), ';' order by pl.tablename, pl.policyname))
                                        from pg_policies pl where pl.schemaname = 'public'
                                         and pl.tablename in ('organization_invitations', 'organization_members', 'profiles', 'organizations')
                                         and pl.policyname <> 'owners_can_create_invitations')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- ─── B. The migration, verbatim ───────────────────────────────────────────────
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

-- ─── C. Test helpers (temporary, gone with the rollback) ─────────────────────
create function pg_temp.dr_user(p_id uuid, p_email text, p_meta jsonb, p_proven boolean, p_status text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', p_meta, now(), now(), now());
  update public.profiles set email_proven_at = case when p_proven then now() end,
         access_status = p_status::public.access_status_enum
   where user_id = p_id;
end
$f$;
create function pg_temp.dr_org(p_id uuid, p_name text, p_status text, p_owner uuid, p_code text)
returns void language plpgsql as $f$
begin
  insert into public.organizations (id, name, slug, access_status, organization_type, owner_user_id, created_by_user_id, claim_code)
  values (p_id, p_name, 'dryrun-' || p_id, p_status, 'marina', p_owner, p_owner, p_code);
  if p_owner is not null then
    insert into public.organization_members (organization_id, user_id, role) values (p_id, p_owner, 'owner');
  end if;
end
$f$;
create function pg_temp.dr_person(p_id uuid, p_email text, p_intent jsonb, p_proven boolean, p_status text)
returns void language sql as $f$
  select pg_temp.dr_user(p_id, p_email, jsonb_build_object('first_name', 'Pat', 'last_name', 'Doe', 'signup_intent', p_intent), p_proven, p_status)
$f$;
-- runs a pg_cron job's command now (as postgres); the number of rows it wrote
create function pg_temp.dr_cron(p_name text) returns bigint language plpgsql as $f$
declare
  v_n bigint;
begin
  execute (select j.command from cron.job j where j.jobname = p_name);
  get diagnostics v_n = row_count;
  return v_n;
end
$f$;

-- ─── D. Checks and cases ──────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_claims jsonb; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
begin
  vars := jsonb_build_object(
    'owner', gen_random_uuid(), 'inv', gen_random_uuid(), 'other', gen_random_uuid(),
    'e_owner', 'dryrun-owner-' || r8 || '@example.invalid', 'e_inv', 'dryrun-inv-' || r8 || '@example.invalid',
    'e_other', 'dryrun-other-' || r8 || '@example.invalid',
    'org_v', gen_random_uuid(), 'org_n', gen_random_uuid(), 'org_p', gen_random_uuid(), 'org_r', gen_random_uuid(),
    'code_v', 'DRYV' || upper(r8), 'code_n', 'DRYN' || upper(r8),
    'inv_p', gen_random_uuid(), 'inv_j', gen_random_uuid());
  s0 := $s$select pg_temp.dr_user({owner}, {e_owner}, '{}', true, 'verified');
select pg_temp.dr_user({inv}, {e_inv}, '{}', false, 'pending');
select pg_temp.dr_user({other}, {e_other}, '{}', false, 'pending');
select pg_temp.dr_org({org_v}, 'Dryrun Zebramarina S.A.R.L.', 'verified', {owner}, {code_v});
select pg_temp.dr_org({org_n}, 'Dryrun Ownerless Yard', 'verified', null, {code_n});
select pg_temp.dr_org({org_p}, 'Dryrun Pending Docks', 'pending', null, null)$s$;

  tests := jsonb_build_array(
    -- ── Structure ──
    jsonb_build_object('id', 'S01', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'status CHECK = 7 statuses (rejected, claim_requested added)',
      'q', $q$select pg_get_constraintdef(c.oid) = 'CHECK ((status = ANY (ARRAY[''pending''::text, ''accepted''::text, ''expired''::text, ''cancelled''::text, ''join_requested''::text, ''rejected''::text, ''claim_requested''::text])))' from pg_constraint c where c.conrelid = 'public.organization_invitations'::regclass and c.conname = 'organization_invitations_status_check'$q$),
    jsonb_build_object('id', 'S02', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'code_matched boolean not null default false + its CHECK',
      'q', $q$select a.attnotnull and pg_get_expr(d.adbin, d.adrelid) = 'false' and exists (select 1 from pg_constraint c where c.conname = 'organization_invitations_code_matched_check') from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.organization_invitations'::regclass and a.attname = 'code_matched'$q$),
    jsonb_build_object('id', 'S03', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'insert policy: owner, pending, signed by the caller, expires_at <= now() + 30 days; noted signup_identity',
      'q', $q$select p.with_check like '%''owner''%' and p.with_check like '%''pending''%' and p.with_check like '%invited_by_user_id = auth.uid()%' and p.with_check like '%expires_at <= (now() + ''30 days''::interval)%' and obj_description(pp.oid, 'pg_policy') like 'signup_identity %' from pg_policies p join pg_policy pp on pp.polname = p.policyname and pp.polrelid = 'public.organization_invitations'::regclass where p.tablename = 'organization_invitations' and p.policyname = 'owners_can_create_invitations'$q$),
    jsonb_build_object('id', 'S04', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'replaced functions carry this file''s bodies; reject_join_request untouched',
      'q', $q$select count(*) = 4 and bool_and(md5(replace(p.prosrc, chr(13), '')) = x.m) from (values ('public.accept_org_invitation(uuid)', 'd2931bc02461e4f80fdda4aefa29fd41'), ('public.claim_organization(text)', 'c67aa88884d0494efe26c3ada41c8d8e'), ('public.claim_organization_for_user(uuid,text)', 'da43fcccea2e39f0450347289da7d5e8'), ('public.reject_join_request(uuid)', '8b8efcc5956f01847e4983ca8202a50e')) x(s, m) join pg_proc p on p.oid = to_regprocedure(x.s)$q$),
    jsonb_build_object('id', 'S05', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'unchanged: SM26, gl_guest tokens, invitations, companies, members, profiles, other policies, ACLs and owners',
      'q', $q$select count(*) = (select count(*) from _dr_before) and bool_and(b.v = a.v) from _dr_before b join pg_temp.dr_snap() a on a.k = b.k$q$),
    jsonb_build_object('id', 'S06', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'EXECUTE: company_search for the service role only (not anon, authenticated or PUBLIC)',
      'q', $q$select has_function_privilege('service_role', 'public.company_search(text,integer)', 'execute') and not has_function_privilege('anon', 'public.company_search(text,integer)', 'execute') and not has_function_privilege('authenticated', 'public.company_search(text,integer)', 'execute') and not has_function_privilege('public', 'public.company_search(text,integer)', 'execute')$q$),
    jsonb_build_object('id', 'S07', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'no /join/<token> table or RPC (the edge functions sign the team links)',
      'q', $q$select to_regclass('public.org_invitation_token') is null and to_regprocedure('public.org_invitation_resolve(text)') is null and to_regprocedure('public.org_invitation_issue_token(uuid)') is null and to_regprocedure('public.org_invitation_by_token(text)') is null and to_regprocedure('public.accept_org_invitation_for(uuid,text)') is null and to_regprocedure('public.accept_org_invitation_by_token(text)') is null$q$),
    jsonb_build_object('id', 'S08', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'normalize_org_name: accents, dots, legal-form suffixes only (never a leading word), empty -> null',
      'q', $q$select public.normalize_org_name('S.A.R.L. Le Port de Göcek') = 'sarl le port de gocek' and public.normalize_org_name('D-Marin Göcek d.o.o.') = 'd marin gocek' and public.normalize_org_name('Marina Ltd.') = 'marina' and public.normalize_org_name('Port Hercule S.A.M.') = 'port hercule' and public.normalize_org_name('Spa Resorts SpA') = 'spa resorts' and public.normalize_org_name('SA Monaco Marina Management') = 'sa monaco marina management' and public.normalize_org_name('Marina SA SAS') = 'marina' and public.normalize_org_name('SAS') = 'sas' and public.normalize_org_name('Kuşadası  Setur, Marina') = 'kusadasi setur marina' and public.normalize_org_name(' ... ') is null and public.normalize_org_name(null) is null$q$),
    jsonb_build_object('id', 'S09', 'who', 'postgres', 'bare', true, 'expect', 'ret:true', 'label', 'GIN trigram expression index on normalize_org_name(name) with extensions.gin_trgm_ops; both helpers IMMUTABLE',
      'q', $q$select exists (select 1 from pg_index x join pg_opclass oc on oc.oid = x.indclass[0] join pg_am am on am.oid = (select c.relam from pg_class c where c.oid = x.indexrelid) where x.indexrelid = to_regclass('public.organizations_name_norm_trgm_idx') and x.indrelid = 'public.organizations'::regclass and am.amname = 'gin' and oc.opcname = 'gin_trgm_ops' and oc.opcnamespace = 'extensions'::regnamespace and pg_get_indexdef(x.indexrelid) like '%normalize_org_name(name)%') and (select bool_and(provolatile = 'i') from pg_proc where oid in ('public.normalize_org_name(text)'::regprocedure, 'public.immutable_unaccent(text)'::regprocedure))$q$),
    -- ── Owners' invitations ──
    jsonb_build_object('id', 'I01', 'who', 'owner', 'expect', 'allow', 'label', 'owner invites as both clients do (pending, default expiry)',
      'q', $q$insert into public.organization_invitations (organization_id, email, invited_by_user_id) values ({org_v}, 'dryrun-new@example.invalid', {owner})$q$),
    jsonb_build_object('id', 'I02', 'who', 'owner', 'expect', 'rls', 'label', 'owner cannot write an invitation valid for a year',
      'q', $q$insert into public.organization_invitations (organization_id, email, invited_by_user_id, expires_at) values ({org_v}, 'dryrun-new@example.invalid', {owner}, now() + interval '1 year')$q$),
    jsonb_build_object('id', 'I03', 'who', 'owner', 'expect', 'rls', 'label', 'owner cannot write a claim_requested row',
      'q', $q$insert into public.organization_invitations (organization_id, email, invited_by_user_id, status) values ({org_v}, 'dryrun-new@example.invalid', {owner}, 'claim_requested')$q$),
    jsonb_build_object('id', 'I04', 'who', 'owner', 'expect', 'err:organization_invitations_code_matched_check', 'label', 'code_matched is never set on an invitation',
      'q', $q$insert into public.organization_invitations (organization_id, email, invited_by_user_id, code_matched) values ({org_v}, 'dryrun-new@example.invalid', {owner}, true)$q$),
    jsonb_build_object('id', 'I05', 'who', 'owner', 'expect', 'rls', 'label', 'owner cannot turn a join request into a claim',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, status) values ({inv_j}, {org_v}, {e_other}, 'join_requested')$s$,
      'q', $q$update public.organization_invitations set status = 'claim_requested' where id = {inv_j}$q$),
    jsonb_build_object('id', 'I06', 'who', 'owner', 'expect', 'allow', 'label', 'Decline works: reject_join_request writes rejected (was 23514)',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, status) values ({inv_j}, {org_v}, {e_other}, 'join_requested')$s$,
      'q', $q$select public.reject_join_request({inv_j})$q$,
      'chk', $c$select status = 'rejected' from public.organization_invitations where id = {inv_j}$c$),
    jsonb_build_object('id', 'I07', 'who', 'inv', 'expect', 'err:has expired', 'label', 'accept_org_invitation refuses an invitation past expires_at',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, invited_by_user_id, expires_at, created_at) values ({inv_p}, {org_v}, {e_inv}, {owner}, now() - interval '1 day', now() - interval '31 days')$s$,
      'q', $q$select public.accept_org_invitation({inv_p})$q$),
    jsonb_build_object('id', 'I08', 'who', 'inv', 'expect', 'allow', 'label', 'a valid invitation of a verified company: collaborator, person verified',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, invited_by_user_id) values ({inv_p}, {org_v}, {e_inv}, {owner})$s$,
      'q', $q$select public.accept_org_invitation({inv_p})$q$,
      'chk', $c$select exists (select 1 from public.organization_members where organization_id = {org_v} and user_id = {inv} and role = 'collaborator') and (select access_status::text = 'verified' from public.profiles where user_id = {inv})$c$),
    jsonb_build_object('id', 'I09', 'who', 'inv', 'expect', 'allow', 'label', 'a suspended account accepting stays suspended',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, invited_by_user_id) values ({inv_p}, {org_v}, {e_inv}, {owner}); update public.profiles set access_status = 'suspended' where user_id = {inv}$s$,
      'q', $q$select public.accept_org_invitation({inv_p})$q$,
      'chk', $c$select access_status::text = 'suspended' from public.profiles where user_id = {inv}$c$),
    jsonb_build_object('id', 'I10', 'who', 'anon', 'expect', 'ret:<e_inv>', 'label', 'old /join/<id> page still reads its invitation (get_invitation_for_join)',
      'setup', $s$insert into public.organization_invitations (id, organization_id, email, invited_by_user_id) values ({inv_p}, {org_v}, {e_inv}, {owner})$s$,
      'q', $q$select email from public.get_invitation_for_join({inv_p})$q$)
  );

  -- ── Runner ── each case: common setup s0 (unless bare), its setup (postgres), the
  -- statement as the caller, chk (postgres), then rolled back. {name} in SQL = the
  -- quoted value of vars.name; <name> in an expectation = its raw value.
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
      if btrim(v_setup, ' ;') <> '' then execute v_setup; end if;
      perform set_config('request.jwt.claim.sub', '', true);
      if t ->> 'who' = 'postgres' then
        perform set_config('request.jwt.claims', '', true);
      elsif t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', '{"role": "anon"}', true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
        set local role service_role;
      else
        v_uid := (vars ->> (t ->> 'who'))::uuid;
        v_claims := jsonb_build_object('sub', v_uid, 'role', 'authenticated',
                                       'email', (select u.email from auth.users u where u.id = v_uid))
                    || coalesce(t -> 'claims', '{}'::jsonb);
        perform set_config('request.jwt.claims', v_claims::text, true);
        set local role authenticated;
      end if;
      if v_dml then
        execute v_q;
        get diagnostics v_n = row_count;
      else
        execute v_q into v_ret;
      end if;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if v_chkq <> '' then execute v_chkq into v_chk; end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := sqlerrm; v_state := sqlstate;
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
                else 'returned ' || coalesce(v_ret, 'null') end, 200),
      case when v_chkq <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (signup_identity_orgs, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
