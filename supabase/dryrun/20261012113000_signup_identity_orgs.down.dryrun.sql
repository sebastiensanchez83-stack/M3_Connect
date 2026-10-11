-- DRY RUN of the DOWN of supabase/migrations/20261012113000_signup_identity_orgs.sql. NOT A
-- MIGRATION. ONE query text, ONE execute_sql call, after 20261009210000_registration_core and
-- BEFORE 20261012113500_signup_identity is applied (the down of part 1 refuses to run while
-- part 2 is in place). Snapshot, the migration verbatim, a declined request and a claim, the
-- down verbatim, then checks that production is back (function bodies, status CHECK, the
-- policy of 20261011083257 with its note, new objects gone, the two rows cancelled, snapshot).
-- Ends with RAISE EXCEPTION 'DRYRUN ...'; everything rolls back. Expected: "7 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot (read again after the migration: must be identical) ─────────
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'acl ' || p.oid::regprocedure::text, coalesce(p.proacl::text, '') || ' ' || pg_get_userbyid(p.proowner)
    from pg_proc p
   where p.oid in ('public.accept_org_invitation(uuid)'::regprocedure, 'public.claim_organization(text)'::regprocedure,
                   'public.claim_organization_for_user(uuid,text)'::regprocedure, 'public.reject_join_request(uuid)'::regprocedure,
                   'public.approve_join_request(uuid)'::regprocedure, 'public.handle_new_user()'::regprocedure,
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
  union all select 'invitations', (select md5(coalesce(string_agg(i.id::text || i.status || i.email || i.expires_at::text, ',' order by i.id), '')) from public.organization_invitations i)
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
-- NOT APPLIED. Apply after 20261009210000_registration_core, before
-- 20261012113500_signup_identity (part 2, which needs the statuses added here).
-- Down: supabase/migrations/down/20261012113000_signup_identity_orgs.down.sql.
-- Dry run: supabase/dryrun/20261012113000_signup_identity_orgs.dryrun.sql.
--
-- For the live main site and for the redesign with every flag off, only these change:
--   * Decline on a join request works: status 'rejected' is allowed (reject_join_request
--     always wrote it; the CHECK refused it, error 23514). Both clients, both
--     send-notification versions and the InvitationStatus type already know 'rejected'.
--   * A claim code no longer makes anyone a member of a company that already has an
--     owner (claim_organization, claim_organization_for_user). Victor, 11 Oct 2026.
--   * accept_org_invitation refuses an invitation past its expires_at (30 days), and never
--     turns a suspended account into a verified one.
--   * An owner can no longer write an invitation that expires later than 30 days.
-- New, unused until the Phase 2 functions and pages call them: status 'claim_requested',
-- column code_matched, org_invitation_token (/join/<token> links, sha256 only) and its
-- RPCs, normalize_org_name + trigram index, company_search.
-- Not touched: reject_join_request, approve_join_request, request_org_join,
-- create_organization, get_invitation_for_join (old /join/<id> links keep resolving).

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
-- punctuation -> space, legal forms dropped at either end, spaces collapsed; NULL when
-- nothing is left. 'sam' (Monaco's S.A.M.) is added to the spec's list.
create or replace function public.normalize_org_name(p text)
returns text
language sql
immutable
strict
parallel safe
set search_path to ''
return nullif(pg_catalog.btrim(pg_catalog.regexp_replace(
  pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(pg_catalog.regexp_replace(
        pg_catalog.replace(pg_catalog.lower(public.immutable_unaccent(pg_catalog.normalize(p, 'NFD'))), '.', ''),
        '[^[:alnum:]]+', ' ', 'g')),
      '^((sas|sarl|sa|sam|ltd|llc|inc|gmbh|srl|spa|bv|doo) )+', ''),
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

-- ---- 3. Team links /join/<token> ----------------------------------------------
create table if not exists public.org_invitation_token (
  token_hash bytea primary key,                 -- sha256(raw token); the raw token is only in the e-mail
  invitation_id uuid not null references public.organization_invitations(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists org_invitation_token_inv_idx on public.org_invitation_token (invitation_id);
alter table public.org_invitation_token enable row level security;
revoke all on table public.org_invitation_token from anon, authenticated;
comment on table public.org_invitation_token is 'Phase 2: /join/<token> team links (sha256 only). Service role only, through the org_invitation_* functions.';

-- Raw token -> {invitation_id} or {error: invalid_token | already_accepted | not_pending | expired}.
create or replace function public.org_invitation_resolve(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_inv uuid;
  v_texp timestamptz;
  v_rev timestamptz;
  v_status text;
  v_iexp timestamptz;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then
    return jsonb_build_object('error', 'invalid_token');
  end if;
  select t.invitation_id, t.expires_at, t.revoked_at into v_inv, v_texp, v_rev
    from public.org_invitation_token t where t.token_hash = extensions.digest(p_token, 'sha256');
  if v_inv is null or v_rev is not null then
    return jsonb_build_object('error', 'invalid_token');
  end if;
  select i.status, i.expires_at into v_status, v_iexp from public.organization_invitations i where i.id = v_inv;
  if v_status is null then
    return jsonb_build_object('error', 'invalid_token');
  elsif v_status = 'accepted' then
    return jsonb_build_object('error', 'already_accepted', 'invitation_id', v_inv);
  elsif v_status <> 'pending' then
    return jsonb_build_object('error', 'not_pending', 'invitation_id', v_inv);
  elsif v_texp < now() or v_iexp < now() then
    return jsonb_build_object('error', 'expired', 'invitation_id', v_inv);
  end if;
  return jsonb_build_object('invitation_id', v_inv);
end
$function$;

-- Service role (send-notification, team_invitation and its reminder): a new link valid
-- 30 days; the invitation stays open at least as long. Errors (22023): not_found, not_pending.
create or replace function public.org_invitation_issue_token(p_invitation_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_raw text;
  v_exp timestamptz := now() + interval '30 days';
begin
  select i.status into v_status from public.organization_invitations i where i.id = p_invitation_id for update;
  if v_status is null then
    raise exception using errcode = '22023', message = 'not_found';
  end if;
  if v_status <> 'pending' then
    raise exception using errcode = '22023', message = 'not_pending';
  end if;
  -- 32 random bytes, base64url without padding (43 characters), as gl_issue_access_token.
  v_raw := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.org_invitation_token (token_hash, invitation_id, expires_at)
  values (extensions.digest(v_raw, 'sha256'), p_invitation_id, v_exp);
  update public.organization_invitations set expires_at = v_exp where id = p_invitation_id and expires_at < v_exp;
  return v_raw;
end
$function$;

-- Service role (accept-invite): what /join/<token> shows, or {ok:false, error[, invitation_id]}.
create or replace function public.org_invitation_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_r jsonb := public.org_invitation_resolve(p_token);
  v_out jsonb;
begin
  if v_r ? 'error' then
    return jsonb_build_object('ok', false) || v_r;
  end if;
  select jsonb_build_object('ok', true, 'invitation_id', i.id, 'organization_id', o.id, 'organization_name', o.name,
           'organization_verified', o.access_status = 'verified', 'email', i.email, 'first_name', i.first_name,
           'last_name', i.last_name, 'expires_at', i.expires_at,
           'inviter_name', coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'A team member'),
           'account_exists', exists (select 1 from auth.users u where lower(u.email) = lower(btrim(i.email))))
    into v_out
    from public.organization_invitations i
    join public.organizations o on o.id = i.organization_id
    left join public.profiles p on p.user_id = i.invited_by_user_id
   where i.id = (v_r ->> 'invitation_id')::uuid;
  return v_out;
end
$function$;

-- Service role (accept-invite, for the account it has just created for the invited address
-- with the password typed on /join/<token>): accept_org_invitation's rules for p_user_id.
-- Proof is separate: accept-invite then calls on_email_proven(p_user_id) for an account it
-- created (the token reached that inbox and the password was chosen there).
-- {ok, organization_id, organization_name, verified} or {ok:false, error: invalid_token |
-- already_accepted | not_pending | expired | unknown_user | email_mismatch | not_confirmed}.
create or replace function public.accept_org_invitation_for(p_user_id uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_r jsonb := public.org_invitation_resolve(p_token);
  v_inv uuid;
  v_org uuid;
  v_iemail text;
  v_email text;
  v_confirmed boolean;
  v_verified boolean;
  v_name text;
begin
  if v_r ? 'error' then
    return jsonb_build_object('ok', false) || v_r;
  end if;
  v_inv := (v_r ->> 'invitation_id')::uuid;
  select u.email, u.email_confirmed_at is not null into v_email, v_confirmed from auth.users u where u.id = p_user_id;
  if v_email is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_user');
  end if;
  select i.organization_id, i.email into v_org, v_iemail
    from public.organization_invitations i where i.id = v_inv and i.status = 'pending' for update;
  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  if lower(btrim(v_iemail)) <> lower(v_email) then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;
  if not v_confirmed then
    return jsonb_build_object('ok', false, 'error', 'not_confirmed');
  end if;
  update public.organization_invitations set status = 'accepted' where id = v_inv;
  if not exists (select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = p_user_id) then
    insert into public.organization_members (user_id, organization_id, role) values (p_user_id, v_org, 'collaborator');
  end if;
  select o.access_status = 'verified', o.name into v_verified, v_name from public.organizations o where o.id = v_org;
  if v_verified then
    update public.profiles set access_status = 'verified', onboarding_status = 'completed', updated_at = now()
     where user_id = p_user_id and access_status <> 'suspended';
  else
    update public.profiles set onboarding_status = 'submitted', updated_at = now()
     where user_id = p_user_id and access_status <> 'verified';
  end if;
  update public.org_invitation_token set used_at = now()
   where token_hash = extensions.digest(p_token, 'sha256') and used_at is null;
  return jsonb_build_object('ok', true, 'organization_id', v_org, 'organization_name', v_name, 'verified', coalesce(v_verified, false));
end
$function$;

-- Signed in with the invited address: accept through the link's token. accept_org_invitation's
-- rules and messages; token errors raise 22023 with the code as message.
create or replace function public.accept_org_invitation_by_token(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_r jsonb := public.org_invitation_resolve(p_token);
  v_inv uuid;
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_signed_in';
  end if;
  if v_r ? 'error' then
    raise exception using errcode = '22023', message = v_r ->> 'error';
  end if;
  v_inv := (v_r ->> 'invitation_id')::uuid;
  perform public.accept_org_invitation(v_inv);
  update public.org_invitation_token set used_at = now()
   where token_hash = extensions.digest(p_token, 'sha256') and used_at is null;
  select jsonb_build_object('ok', true, 'organization_id', o.id, 'organization_name', o.name,
                            'verified', o.access_status = 'verified')
    into v_out
    from public.organization_invitations i join public.organizations o on o.id = i.organization_id
   where i.id = v_inv;
  return v_out;
end
$function$;

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
revoke all on function public.org_invitation_resolve(text) from public, anon, authenticated;
revoke all on function public.org_invitation_issue_token(uuid) from public, anon, authenticated;
grant execute on function public.org_invitation_issue_token(uuid) to service_role;
revoke all on function public.org_invitation_by_token(text) from public, anon, authenticated;
grant execute on function public.org_invitation_by_token(text) to service_role;
revoke all on function public.accept_org_invitation_for(uuid, text) from public, anon, authenticated;
grant execute on function public.accept_org_invitation_for(uuid, text) to service_role;
revoke all on function public.accept_org_invitation_by_token(text) from public, anon;
grant execute on function public.accept_org_invitation_by_token(text) to authenticated;
revoke all on function public.company_search(text, integer) from public, anon, authenticated;
grant execute on function public.company_search(text, integer) to service_role;

-- ─── E. Rows in the two new statuses, then the DOWN script verbatim ───────────
insert into public.organization_invitations (organization_id, email, status)
select o.id, 'dryrun-down-rejected@example.invalid', 'rejected' from public.organizations o order by o.created_at limit 1;
insert into public.organization_invitations (organization_id, email, status, code_matched)
select o.id, 'dryrun-down-claim@example.invalid', 'claim_requested', true from public.organizations o order by o.created_at limit 1;

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

-- ─── F. After the down ────────────────────────────────────────────────────────
do $after$
declare
  results text := '';
  n_pass integer := 0;
  n_fail integer := 0;
  v_c record;
  v_ok boolean;
  v_err text;
  v_sp text := current_setting('search_path');
begin
  perform set_config('search_path', 'public', true);
  select md5(format('%s|%s|%s|%s|%s', p.permissive, p.cmd, p.roles, p.qual, p.with_check)) = '3cd3e879f8c5dba7a69ba174c5d77276'
         and obj_description(pp.oid, 'pg_policy') = 'org_members_no_forced_join 3cd3e879f8c5dba7a69ba174c5d77276'
    into v_ok
    from pg_policies p join pg_policy pp on pp.polname = p.policyname and pp.polrelid = 'public.organization_invitations'::regclass
   where p.schemaname = 'public' and p.tablename = 'organization_invitations' and p.policyname = 'owners_can_create_invitations';
  perform set_config('search_path', v_sp, true);
  perform set_config('dr.d03', coalesce(v_ok, false)::text, true);
  -- the two test rows go only if the down cancelled them (D05), then the snapshot must match (D06)
  delete from public.organization_invitations
   where email in ('dryrun-down-rejected@example.invalid', 'dryrun-down-claim@example.invalid') and status = 'cancelled';
  for v_c in select * from (values
    ('D01', 'accept_org_invitation, claim_organization, claim_organization_for_user = production bodies',
     $q$select bool_and(md5(replace(p.prosrc, chr(13), '')) = x.m) from (values ('public.accept_org_invitation(uuid)', '40836bda218b0284d91a28f4d3d0c3c7'), ('public.claim_organization(text)', '9e76262902c0ff2524c2134a13a99f57'), ('public.claim_organization_for_user(uuid,text)', '03948e99491c8c9ce5472388f36f9c8a'), ('public.reject_join_request(uuid)', '8b8efcc5956f01847e4983ca8202a50e')) x(s, m) join pg_proc p on p.oid = to_regprocedure(x.s)$q$),
    ('D02', 'status CHECK = the 5 production statuses; code_matched gone',
     $q$select pg_get_constraintdef(c.oid) = 'CHECK ((status = ANY (ARRAY[''pending''::text, ''accepted''::text, ''expired''::text, ''cancelled''::text, ''join_requested''::text])))' and not exists (select 1 from pg_attribute a where a.attrelid = 'public.organization_invitations'::regclass and a.attname = 'code_matched' and not a.attisdropped) from pg_constraint c where c.conrelid = 'public.organization_invitations'::regclass and c.conname = 'organization_invitations_status_check'$q$),
    ('D03', 'owners_can_create_invitations = 20261011083257 (fingerprint 3cd3e879 and its note: that migration''s own down still recognises it)',
     $q$select current_setting('dr.d03')::boolean$q$),
    ('D04', 'new objects gone (token table, 6 functions, index, normalize_org_name, immutable_unaccent)',
     $q$select to_regclass('public.org_invitation_token') is null and to_regclass('public.organizations_name_norm_trgm_idx') is null and to_regprocedure('public.org_invitation_resolve(text)') is null and to_regprocedure('public.org_invitation_issue_token(uuid)') is null and to_regprocedure('public.org_invitation_by_token(text)') is null and to_regprocedure('public.accept_org_invitation_for(uuid,text)') is null and to_regprocedure('public.accept_org_invitation_by_token(text)') is null and to_regprocedure('public.company_search(text,integer)') is null and to_regprocedure('public.normalize_org_name(text)') is null and to_regprocedure('public.immutable_unaccent(text)') is null$q$),
    ('D05', 'the declined request and the claim were set to cancelled',
     $q$select not exists (select 1 from public.organization_invitations where email in ('dryrun-down-rejected@example.invalid', 'dryrun-down-claim@example.invalid'))$q$),
    ('D06', 'snapshot = before (SM26, gl_guest, invitations, companies, members, profiles, policies, ACLs and owners)',
     $q$select count(*) = (select count(*) from _dr_before) and bool_and(b.v = a.v) from _dr_before b join pg_temp.dr_snap() a on a.k = b.k$q$),
    ('D07', 'EXECUTE as before: accept_org_invitation for anon too, claim_organization_for_user service only',
     $q$select has_function_privilege('anon', 'public.accept_org_invitation(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.claim_organization_for_user(uuid,text)', 'execute') and has_function_privilege('authenticated', 'public.claim_organization(text)', 'execute')$q$)
  ) x(id, label, q)
  loop
    v_err := null;
    begin
      execute v_c.q into v_ok;
    exception when others then
      v_ok := false; v_err := sqlerrm;
    end;
    if coalesce(v_ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s down: %s%s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end,
                                 v_c.id, v_c.label, coalesce(' | error ' || v_err, ''));
  end loop;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (signup_identity_orgs DOWN, run %s)', n_pass, n_fail, now()) || results;
end
$after$;
