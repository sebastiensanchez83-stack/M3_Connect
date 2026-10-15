-- DRY RUN 3 of supabase/migrations/20261012113500_signup_identity.sql: e-mail proof
-- (issue_email_proof_token, confirm_email_proof), notification_outbox, and a code typed with a
-- company picked in the list (C17-C19, 15 Oct 2026). NOT A MIGRATION.
-- ONE query text, ONE execute_sql call, AFTER 20261012113000_signup_identity_orgs is applied.
-- Same harness as dry run 1. Ends with RAISE EXCEPTION 'DRYRUN ...'; everything rolls back.
-- Expected: "24 PASS, 0 FAIL".

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
-- Unified registration, Phase 2 (DB lane), part 2 of 2: sign-up identity.
-- Spec: regspec-en.md §3.8, §4.4, §4.6, §5; Victor 6/8/11 Oct 2026. Contract: docs/registration-contract.md "Phase 2".
-- NOT APPLIED. Apply after 20261012113000_signup_identity_orgs (checked below).
-- Down: supabase/migrations/down/20261012113500_signup_identity.down.sql.
-- Dry runs: supabase/dryrun/20261012113500_signup_identity.dryrun.sql, .dryrun2.sql, .dryrun3.sql.
-- The legacy proof backfill (§5) is a separate file, 20261012114000_signup_identity_backfill,
-- applied only once Victor has chosen which sessions count (see that file).
--
-- For the live main site and for the redesign with every flag off, nothing visible
-- changes: a new account's profile row is the one of today (same persona whitelist,
-- names, e-mail, job title, pending/draft) plus signup_source 'account' for a sign-up
-- form; the sign-up form v2 keys (signup_intent, country, affiliation, sector_ids,
-- declared_type) are read only when present. Nothing runs an intent while the flag
-- account_signup_v2 is off (registration_flags, JSON true), nor before an address is
-- PROVEN: no join or claim request, no e-mail queued.
--  1. Private tables: email_proof_token, signup_claim_code (a claim code typed at sign-up:
--     never in profiles, which co-members read), notification_outbox (staff read).
--  2. handle_new_user: whitelist + length caps; never access_status, staff persona or proof.
--  3. complete_signup_for (replaces the Phase 1 stub, same signature), complete_my_signup,
--     submit_signup_intent ("Add my company", claim link while signed in).
--  4. issue_email_proof_token (service role), confirm_email_proof (/verify-email; a
--     PASSWORD session only, as the Phase 1 rule of mark_email_proven).
--  5. notification_outbox_claim / _done (service role): e-mails queued here, sent once.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---- 0. Preconditions --------------------------------------------------------
do $pre$
declare
  v_md5 text;
  v_row record;
begin
  if to_regprocedure('public.on_email_proven(uuid)') is null
     or to_regprocedure('public.attach_my_records_for(uuid)') is null
     or to_regprocedure('public.gl_try_ts(text)') is null
     or to_regclass('public.review_log') is null
     or to_regclass('public.profile_interest_sectors') is null
     or to_regclass('public.admin_impersonation_log') is null then
    raise exception 'signup_identity: apply 20261009210000_registration_core first';
  end if;
  if to_regprocedure('public.company_search(text,integer)') is null
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.organization_invitations'::regclass
                     and a.attname = 'code_matched' and not a.attisdropped) then
    raise exception 'signup_identity: apply 20261012113000_signup_identity_orgs first';
  end if;
  for v_row in
    select * from (values
      ('public.handle_new_user()', '7155140fe02bab9470760711b36342fa', '4729540e868841759ad598be8d1a08f1'),
      ('public.complete_signup_for(uuid)', '2baf4cc8093e56ae2541290378f49f69', '67a850075f0e06e93b1ab02a377408ae')
    ) as x(sig, prod, mine)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_row.sig);
    if v_md5 is distinct from v_row.prod and v_md5 is distinct from v_row.mine then
      raise exception 'signup_identity: % changed (md5 %); rebuild this migration from pg_get_functiondef', v_row.sig, v_md5;
    end if;
  end loop;
end
$pre$;

-- ---- 1. Private tables ----------------------------------------------------------
create table if not exists public.email_proof_token (
  token_hash bytea primary key,                 -- sha256(raw token); the raw token is only in the e-mail
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,                          -- lower(auth e-mail) when issued
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists email_proof_token_user_idx on public.email_proof_token (user_id, created_at desc);

create table if not exists public.signup_claim_code (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null check (char_length(code) between 3 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('account_under_review', 'team_join_request')),
  user_id uuid not null references auth.users(id) on delete cascade,   -- recipient
  actor_id uuid references auth.users(id) on delete set null,          -- whose action queued it
  subject_id uuid,                                                      -- the person / the join request
  dedupe_key text not null unique,                                      -- queued once, ever
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz,
  last_error text
);
create index if not exists notification_outbox_due_idx on public.notification_outbox (id) where sent_at is null;

alter table public.email_proof_token enable row level security;
alter table public.signup_claim_code enable row level security;
alter table public.notification_outbox enable row level security;
revoke all on table public.email_proof_token, public.signup_claim_code, public.notification_outbox from anon, authenticated;
grant select on table public.notification_outbox to authenticated;
drop policy if exists notification_outbox_staff_read on public.notification_outbox;
create policy notification_outbox_staff_read on public.notification_outbox
  for select to authenticated using (public.is_moderator());

comment on table public.email_proof_token is 'Phase 2: /verify-email links (sha256 only). Service role only; confirm_email_proof() consumes them.';
comment on table public.signup_claim_code is 'Phase 2: a claim code typed at sign-up, until complete_signup_for() checks it once. Never copied to profiles.';
comment on table public.notification_outbox is 'Phase 2: e-mails queued by the database (dedupe_key: once, ever), sent by the edge functions through notification_outbox_claim / _done. Staff read.';

-- ---- 2. Sign-up metadata --------------------------------------------------------
-- profiles.signup_intent: {v, action: join|new|none, org_id, name, website, country, type,
-- has_code} (+ submitted_at; + done_at and result once run). Never the code itself.
create or replace function public.signup_code_clean(p text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case when char_length(pg_catalog.btrim(p)) between 3 and 40 then pg_catalog.btrim(p) end
$function$;

create or replace function public.signup_intent_clean(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_action text;
  v_org text;
  v_type text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return null;
  end if;
  v_action := lower(btrim(coalesce(p ->> 'action', '')));
  v_org := lower(btrim(coalesce(p ->> 'org_id', '')));
  v_type := lower(btrim(coalesce(p ->> 'type', '')));
  if v_org !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_org := null;
  end if;
  if v_action not in ('join', 'new', 'none')
     or (v_action = 'join' and v_org is null and public.signup_code_clean(p ->> 'code') is null) then
    v_action := case when v_org is not null then 'join'
                     when nullif(btrim(coalesce(p ->> 'name', '')), '') is not null then 'new'
                     else 'none' end;
  end if;
  if v_type not in ('marina', 'partner', 'investor', 'developer', 'media_partner', 'participant') then
    v_type := null;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'v', 1,
    'action', v_action,
    'org_id', case when v_action = 'join' then v_org end,
    'name', nullif(left(btrim(regexp_replace(coalesce(p ->> 'name', ''), '[[:cntrl:]]+', ' ', 'g')), 200), ''),
    'website', nullif(left(btrim(regexp_replace(coalesce(p ->> 'website', ''), '[[:cntrl:]]+', ' ', 'g')), 300), ''),
    'country', nullif(left(btrim(regexp_replace(coalesce(p ->> 'country', ''), '[[:cntrl:]]+', ' ', 'g')), 80), ''),
    'type', v_type,
    'has_code', case when public.signup_code_clean(p ->> 'code') is not null then true end));
end
$function$;

revoke all on function public.signup_code_clean(text) from public, anon, authenticated;
revoke all on function public.signup_intent_clean(jsonb) from public, anon, authenticated;

-- Production body (md5 7155140f...) for every key it reads (old client, claim-code-signup,
-- provisioning); names capped at 100 and the job title at 200 characters. The v2 keys are
-- read only when present; a failure there is a WARNING, never a failed sign-up.
-- signup_source: 'account' for a sign-up form (main's, the v2 form, claim-code-signup) and
-- create-admin-user; NULL (as today) for an account one of M3's tools made for the person
-- (metadata pw_pending or provision_job_id: sm26-register, sm26-provision, sponsor-invite,
-- sm26-attendee-invite, provision-person, which then writes 'provisioned').
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meta jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  v_country text;
  v_affiliation text;
  v_intent jsonb;
  v_code text;
BEGIN
  BEGIN
    v_country := nullif(left(btrim(regexp_replace(coalesce(v_meta->>'country', ''), '[[:cntrl:]]+', ' ', 'g')), 80), '');
    v_affiliation := nullif(left(btrim(regexp_replace(coalesce(v_meta->>'affiliation', ''), '[[:cntrl:]]+', ' ', 'g')), 200), '');
    IF jsonb_typeof(v_meta->'signup_intent') = 'object' THEN
      v_intent := public.signup_intent_clean(
        CASE WHEN (v_meta->'signup_intent') ? 'type' THEN v_meta->'signup_intent'
             ELSE (v_meta->'signup_intent') || jsonb_build_object('type', v_meta->>'declared_type') END);
      v_code := public.signup_code_clean(v_meta->'signup_intent'->>'code');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user(%): sign-up details skipped: % (%)', NEW.id, SQLERRM, SQLSTATE;
    v_country := NULL; v_affiliation := NULL; v_intent := NULL; v_code := NULL;
  END;

  INSERT INTO public.profiles (user_id, persona, first_name, last_name, email, job_title, access_status, onboarding_status,
                               signup_source, country, affiliation, signup_intent)
  VALUES (
    NEW.id,
    -- Self-service personas only; staff personas are never taken from metadata.
    CASE
      WHEN v_meta->>'persona'
           IN ('marina', 'partner', 'media_partner', 'developer', 'investor', 'individual')
        THEN (v_meta->>'persona')::persona_enum
      ELSE 'individual'::persona_enum
    END,
    NULLIF(left(v_meta->>'first_name', 100), ''),
    NULLIF(left(v_meta->>'last_name', 100), ''),
    NEW.email,
    NULLIF(left(v_meta->>'job_title', 200), ''),
    'pending',
    'draft',
    CASE WHEN v_meta ? 'pw_pending' OR v_meta ? 'provision_job_id' THEN NULL ELSE 'account' END,
    v_country,
    v_affiliation,
    v_intent
  )
  ON CONFLICT (user_id) DO UPDATE SET
    first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, profiles.last_name),
    email = COALESCE(EXCLUDED.email, profiles.email),
    job_title = COALESCE(EXCLUDED.job_title, profiles.job_title),
    persona = CASE WHEN profiles.persona = 'individual' THEN EXCLUDED.persona ELSE profiles.persona END;

  IF v_code IS NOT NULL THEN
    BEGIN
      INSERT INTO public.signup_claim_code (user_id, code) VALUES (NEW.id, v_code)
      ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, created_at = now();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user(%): claim code skipped: % (%)', NEW.id, SQLERRM, SQLSTATE;
    END;
  END IF;

  IF jsonb_typeof(v_meta->'sector_ids') = 'array' THEN
    BEGIN
      INSERT INTO public.profile_interest_sectors (user_id, sector_id)
      SELECT NEW.id, s.id
        FROM public.sectors s
       WHERE s.is_active
         AND s.id::text IN (SELECT lower(btrim(e.val)) FROM jsonb_array_elements_text(v_meta->'sector_ids') AS e(val) LIMIT 20)
       ORDER BY s.id
       LIMIT 5
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user(%): sectors skipped: % (%)', NEW.id, SQLERRM, SQLSTATE;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---- 3. Running the sign-up intent ----------------------------------------------
-- Same signature as the Phase 1 stub (on_email_proven calls it in its own block). Runs
-- once (signup_intent.done_at), only while the flag account_signup_v2 is on (else
-- {done:false, reason:'flag_off'}: intent and claim code kept for complete_my_signup
-- later) and only for a PROVEN account (email_proven_at set and profiles.email = auth
-- e-mail). An invitation past its expiry is not an open invitation. result.path:
--   join_requested   verified company with an owner: join request, team_join_request e-mail to the owner
--   claim_requested  verified company with no owner, or a claim code of a company with no owner: M3 decides
--   company_pending  company not verified yet: M3 decides
--   new_company      declared company (no row before M3 validates)
--   none             no company (participant)
--   invitation_pending | already_member | org_not_found | join_declined_recently (owner declined < 30 days)
-- result.code: matched | invalid | throttled | refused_has_owner (a code never claims a company
-- that has an owner: Victor, 11 Oct 2026; the request then goes to its owner) | mismatch (the
-- code is another company's than the one picked in the list: the pick stands, the code claims
-- nothing and counts as a failed attempt; integration review, 15 Oct 2026).
-- A pending person goes from onboarding 'draft' to 'submitted' (M3's review list) and gets
-- ONE account_under_review e-mail (notification_outbox, one per person, ever).
create or replace function public.complete_signup_for(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_intent jsonb;
  v_status text;
  v_onb text;
  v_first text;
  v_last text;
  v_proven timestamptz;
  v_pemail text;
  v_email text;
  v_target uuid;
  v_code text;
  v_code_org uuid;
  v_code_res text;
  v_fails integer;
  v_org_name text;
  v_org_status text;
  v_owned boolean;
  v_owner uuid;
  v_open_id uuid;
  v_open_status text;
  v_inv uuid;
  v_path text;
  v_res jsonb;
begin
  select pr.signup_intent, pr.access_status::text, pr.onboarding_status::text, pr.first_name, pr.last_name,
         pr.email_proven_at, lower(pr.email)
    into v_intent, v_status, v_onb, v_first, v_last, v_proven, v_pemail
    from public.profiles pr where pr.user_id = p_user_id
     for update;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'no_profile');
  end if;
  if v_intent is null or jsonb_typeof(v_intent) <> 'object' then
    return jsonb_build_object('done', false, 'reason', 'no_intent');
  end if;
  if v_intent ? 'done_at' then
    return jsonb_build_object('done', true, 'already', true, 'result', v_intent -> 'result');
  end if;
  -- Flags are on only as JSON true (contract §7 item 14). Off: nothing is filed or queued.
  if not coalesce((select (ps.value -> 'account_signup_v2') = 'true'::jsonb
                     from public.platform_settings ps where ps.key = 'registration_flags'), false) then
    return jsonb_build_object('done', false, 'reason', 'flag_off');
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or v_proven is null or v_pemail is distinct from v_email then
    return jsonb_build_object('done', false, 'reason', 'not_proven');
  end if;
  if v_status in ('suspended', 'rejected') then
    return jsonb_build_object('done', false, 'reason', 'account_' || v_status);
  end if;

  if v_intent ->> 'action' = 'join'
     and (v_intent ->> 'org_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_target := (v_intent ->> 'org_id')::uuid;
  end if;

  -- The claim code, checked once, under claim_organization's limit (10 failures an hour).
  delete from public.signup_claim_code c where c.user_id = p_user_id returning c.code into v_code;
  if v_code is not null then
    perform pg_advisory_xact_lock(hashtextextended('org_claim_attempt:' || p_user_id::text, 0));
    select count(*) into v_fails from public.org_claim_attempt a
     where a.user_id = p_user_id and a.attempted_at > now() - interval '1 hour';
    if v_fails >= 10 then
      v_code_res := 'throttled';
    else
      select o.id into v_code_org from public.organizations o
       where o.claim_code is not null and upper(btrim(o.claim_code)) = upper(btrim(v_code))
       order by o.created_at limit 1;
      if v_code_org is null then
        insert into public.org_claim_attempt (user_id) values (p_user_id);
        v_code_res := 'invalid';
      elsif v_target is not null and v_target <> v_code_org then
        insert into public.org_claim_attempt (user_id) values (p_user_id);
        v_code_res := 'mismatch';
      else
        v_code_res := 'matched';
        v_target := v_code_org;
      end if;
    end if;
  end if;

  if v_target is not null then
    select o.name, o.access_status into v_org_name, v_org_status from public.organizations o where o.id = v_target;
    if not found then
      v_path := 'org_not_found';
      v_target := null;
    else
      v_owned := exists (select 1 from public.organization_members m where m.organization_id = v_target and m.role = 'owner')
              or exists (select 1 from public.organizations o where o.id = v_target and o.owner_user_id is not null);
      if v_code_res = 'matched' and v_owned then
        v_code_res := 'refused_has_owner';
      end if;
      select i.id, i.status into v_open_id, v_open_status from public.organization_invitations i
       where i.organization_id = v_target and lower(btrim(i.email)) = v_email
         and i.status in ('pending', 'join_requested', 'claim_requested')
         and (i.status <> 'pending' or i.expires_at >= now())
       order by i.created_at desc limit 1;
      if exists (select 1 from public.organization_members m where m.organization_id = v_target and m.user_id = p_user_id) then
        v_path := 'already_member';
      elsif v_open_id is not null then
        v_path := case v_open_status when 'pending' then 'invitation_pending' else v_open_status end;
        v_inv := v_open_id;
        if v_open_status = 'claim_requested' and v_code_res = 'matched' then
          update public.organization_invitations set code_matched = true where id = v_open_id;
        end if;
      elsif v_code_res = 'matched' or (v_org_status = 'verified' and not v_owned) then
        insert into public.organization_invitations (organization_id, email, normalized_domain, first_name, last_name,
                                                     status, invited_by_user_id, code_matched)
        values (v_target, v_email, nullif(split_part(v_email, '@', 2), ''), v_first, v_last,
                'claim_requested', null, coalesce(v_code_res = 'matched', false))
        returning id into v_inv;
        v_path := 'claim_requested';
      elsif v_org_status = 'verified' then
        if exists (select 1 from public.organization_invitations i
                    where i.organization_id = v_target and lower(btrim(i.email)) = v_email
                      and i.status = 'rejected' and i.updated_at > now() - interval '30 days') then
          v_path := 'join_declined_recently';
        else
          insert into public.organization_invitations (organization_id, email, normalized_domain, first_name, last_name,
                                                       status, invited_by_user_id)
          values (v_target, v_email, nullif(split_part(v_email, '@', 2), ''), v_first, v_last, 'join_requested', null)
          returning id into v_inv;
          v_path := 'join_requested';
          -- The owner of record, when also an owner member (send-notification's realOwnerOf).
          select o.owner_user_id into v_owner from public.organizations o
           where o.id = v_target
             and exists (select 1 from public.organization_members m
                          where m.organization_id = o.id and m.user_id = o.owner_user_id and m.role = 'owner');
          if v_owner is not null then
            insert into public.notification_outbox (kind, user_id, actor_id, subject_id, dedupe_key, data)
            values ('team_join_request', v_owner, p_user_id, v_inv, 'team_join_request:' || v_inv,
                    jsonb_strip_nulls(jsonb_build_object('organization_id', v_target, 'org_name', v_org_name,
                      'invitation_id', v_inv, 'requester_email', v_email,
                      'requester_name', nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), ''))))
            on conflict (dedupe_key) do nothing;
          end if;
        end if;
      else
        v_path := 'company_pending';
      end if;
    end if;
  elsif v_intent ->> 'action' = 'new' then
    v_path := 'new_company';
    v_org_name := v_intent ->> 'name';
  else
    v_path := 'none';
  end if;

  if v_status = 'pending' and v_onb = 'draft' then
    update public.profiles set onboarding_status = 'submitted' where user_id = p_user_id;
  end if;
  if v_status = 'pending' then
    insert into public.notification_outbox (kind, user_id, actor_id, subject_id, dedupe_key, data)
    values ('account_under_review', p_user_id, p_user_id, p_user_id, 'account_under_review:' || p_user_id,
            jsonb_strip_nulls(jsonb_build_object('path', v_path, 'org_name', v_org_name, 'first_name', v_first)))
    on conflict (dedupe_key) do nothing;
  end if;

  v_res := jsonb_strip_nulls(jsonb_build_object('path', v_path, 'organization_id', v_target,
                                                'invitation_id', v_inv, 'code', v_code_res));
  update public.profiles
     set signup_intent = v_intent || jsonb_build_object('done_at', now(), 'result', v_res)
   where user_id = p_user_id;
  return jsonb_build_object('done', true, 'result', v_res);
end
$function$;

-- Signed in: run my stored intent (idempotent).
create or replace function public.complete_my_signup()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_signed_in';
  end if;
  return public.complete_signup_for(auth.uid());
end
$function$;

-- Signed in, in no company: "Add my company", or a claim link opened while signed in.
-- p_intent has the sign-up shape {action, org_id, name, website, country, type, code}.
-- Runs at once when the address is proven, else once it is. Errors (22023): flag_off
-- (account_signup_v2 off: nothing stored), no_profile, account_suspended,
-- already_in_company, request_pending (an open join or claim request less than 30 days
-- old: its expires_at), too_soon (1 a minute), bad_input.
create or replace function public.submit_signup_intent(p_intent jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_old jsonb;
  v_email text;
  v_clean jsonb;
  v_code text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_signed_in';
  end if;
  if not coalesce((select (ps.value -> 'account_signup_v2') = 'true'::jsonb
                     from public.platform_settings ps where ps.key = 'registration_flags'), false) then
    raise exception using errcode = '22023', message = 'flag_off';
  end if;
  select pr.access_status::text, pr.signup_intent into v_status, v_old
    from public.profiles pr where pr.user_id = v_uid for update;
  if not found then
    raise exception using errcode = '22023', message = 'no_profile';
  end if;
  if v_status = 'suspended' then
    raise exception using errcode = '22023', message = 'account_suspended';
  end if;
  if exists (select 1 from public.organization_members m where m.user_id = v_uid) then
    raise exception using errcode = '22023', message = 'already_in_company';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if exists (select 1 from public.organization_invitations i
              where lower(btrim(i.email)) = v_email and i.status in ('join_requested', 'claim_requested')
                and i.expires_at >= now()) then
    raise exception using errcode = '22023', message = 'request_pending';
  end if;
  if public.gl_try_ts(v_old ->> 'submitted_at') > now() - interval '1 minute' then
    raise exception using errcode = '22023', message = 'too_soon';
  end if;
  v_clean := public.signup_intent_clean(p_intent);
  if v_clean is null then
    raise exception using errcode = '22023', message = 'bad_input';
  end if;
  v_code := public.signup_code_clean(p_intent ->> 'code');
  update public.profiles set signup_intent = v_clean || jsonb_build_object('submitted_at', now()) where user_id = v_uid;
  delete from public.signup_claim_code c where c.user_id = v_uid;
  if v_code is not null then
    insert into public.signup_claim_code (user_id, code) values (v_uid, v_code);
  end if;
  return public.complete_signup_for(v_uid);
end
$function$;

-- ---- 4. E-mail proof (/verify-email) ----------------------------------------------
-- Service role (account-signup send_email_proof): raw token (43 characters, base64url),
-- valid 24 h, sha256 stored. {ok, token, email, expires_at} or {ok:false, error:
-- unknown_user | already_proven | rate_limited (3 an hour)}.
create or replace function public.issue_email_proof_token(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_proven timestamptz;
  v_pemail text;
  v_raw text;
  v_exp timestamptz := now() + interval '24 hours';
begin
  select u.email into v_email from auth.users u where u.id = p_user_id;
  select pr.email_proven_at, lower(pr.email) into v_proven, v_pemail from public.profiles pr where pr.user_id = p_user_id;
  if v_email is null or not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_user');
  end if;
  if v_proven is not null and v_pemail = lower(v_email) then
    return jsonb_build_object('ok', false, 'error', 'already_proven');
  end if;
  if (select count(*) from public.email_proof_token t
       where t.user_id = p_user_id and t.created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  v_raw := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.email_proof_token (token_hash, user_id, email, expires_at)
  values (extensions.digest(v_raw, 'sha256'), p_user_id, lower(v_email), v_exp);
  return jsonb_build_object('ok', true, 'token', v_raw, 'email', v_email, 'expires_at', v_exp);
end
$function$;

-- Signed in (/verify-email?t=): the token's account is the caller, its address the current
-- auth e-mail, no e-mail change since it was issued, not an admin "view as user" session,
-- and the session was opened with the account's PASSWORD (JWT amr 'password'). A link
-- session (magic link, OTP, recovery) proves the inbox, not that the password belongs to
-- the person (Confirm email off: anyone can create an account with another person's
-- address and keep its password): the Phase 1 rule of mark_email_proven. Such a session
-- gets password_session_required: the page sends the person to set a new password
-- (/reset-password, then mark_email_proven), or to sign in with the password.
-- Then the caller holds the password and the link reached the inbox: proof is stamped, and
-- on_email_proven attaches records and runs complete_signup_for. Never a login.
-- {proven, stamped, reason?: invalid_token | wrong_account | email_changed | used | expired |
-- impersonation | password_session_required, attached?, requeued?, signup?}
create or replace function public.confirm_email_proof(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_amr jsonb := auth.jwt() -> 'amr';
  v_hash bytea;
  v_tok_user uuid;
  v_tok_email text;
  v_tok_created timestamptz;
  v_tok_exp timestamptz;
  v_tok_used timestamptz;
  v_email text;
  v_proven timestamptz;
  v_pemail text;
  v_changed timestamptz;
  v_link_at timestamptz;
  v_out jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_signed_in';
  end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'invalid_token');
  end if;
  v_hash := extensions.digest(p_token, 'sha256');
  select t.user_id, t.email, t.created_at, t.expires_at, t.used_at
    into v_tok_user, v_tok_email, v_tok_created, v_tok_exp, v_tok_used
    from public.email_proof_token t where t.token_hash = v_hash for update;
  if v_tok_user is null then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'invalid_token');
  end if;
  if v_tok_user <> v_uid then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'wrong_account');
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  select pr.email_proven_at, lower(pr.email), pr.email_changed_at into v_proven, v_pemail, v_changed
    from public.profiles pr where pr.user_id = v_uid;
  if v_tok_email is distinct from v_email or (v_changed is not null and v_tok_created < v_changed) then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'email_changed');
  end if;
  if v_proven is not null and v_pemail = v_email then
    update public.email_proof_token set used_at = coalesce(used_at, now()) where token_hash = v_hash;
    return jsonb_build_object('proven', true, 'stamped', false, 'attached', public.attach_my_records_for(v_uid),
                              'signup', public.complete_signup_for(v_uid));
  end if;
  if v_tok_used is not null then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'used');
  end if;
  if v_tok_exp < now() then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'expired');
  end if;
  -- An admin "view as user" session (magic link logged by admin-impersonate) proves nothing.
  select max(to_timestamp((a ->> 'timestamp')::double precision)) into v_link_at
    from jsonb_array_elements(case when jsonb_typeof(v_amr) = 'array' then v_amr else '[]'::jsonb end) a
   where a ->> 'method' in ('otp', 'magiclink') and (a ->> 'timestamp') ~ '^[0-9]+([.][0-9]+)?$';
  if v_link_at is not null and exists (
       select 1 from public.admin_impersonation_log l
        where l.target_user_id = v_uid
          and l.created_at between v_link_at - interval '5 minutes' and v_link_at + interval '1 minute') then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'impersonation');
  end if;
  if not exists (select 1
                   from jsonb_array_elements(case when jsonb_typeof(v_amr) = 'array' then v_amr else '[]'::jsonb end) a
                  where a ->> 'method' = 'password') then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'password_session_required');
  end if;
  update public.email_proof_token set used_at = now() where token_hash = v_hash;
  v_out := public.on_email_proven(v_uid);
  return jsonb_build_object('proven', true, 'stamped', true, 'attached', v_out -> 'attached',
                            'requeued', v_out -> 'requeued', 'signup', v_out -> 'signup');
end
$function$;

-- ---- 5. Outbox (service role) ---------------------------------------------------
-- Claims due rows (unsent, < 5 attempts, unclaimed or claimed > 10 minutes ago); p_actor /
-- p_kinds narrow it (send-notification called by the person: p_actor = the caller).
create or replace function public.notification_outbox_claim(p_limit integer default 20, p_actor uuid default null,
                                                           p_kinds text[] default null)
returns setof public.notification_outbox
language sql
volatile
security definer
set search_path = ''
as $function$
  with c as (
    select n.id from public.notification_outbox n
     where n.sent_at is null and n.attempts < 5
       and (n.claimed_at is null or n.claimed_at < now() - interval '10 minutes')
       and (p_actor is null or n.actor_id = p_actor)
       and (p_kinds is null or n.kind = any (p_kinds))
     order by n.id
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
     for update skip locked)
  update public.notification_outbox o
     set claimed_at = now(), attempts = o.attempts + 1
    from c
   where o.id = c.id
  returning o.*
$function$;

-- Sent (p_error null) or failed (claim released for a retry). false = unknown or already sent.
create or replace function public.notification_outbox_done(p_id bigint, p_error text default null)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $function$
  with up as (
    update public.notification_outbox o
       set sent_at = case when p_error is null then now() end,
           last_error = left(p_error, 500),
           claimed_at = case when p_error is null then o.claimed_at end
     where o.id = p_id and o.sent_at is null
    returning 1)
  select exists (select 1 from up)
$function$;

-- ---- 6. EXECUTE -------------------------------------------------------------------
revoke all on function public.complete_signup_for(uuid) from public, anon, authenticated;
grant execute on function public.complete_signup_for(uuid) to service_role;
revoke all on function public.complete_my_signup() from public, anon;
grant execute on function public.complete_my_signup() to authenticated, service_role;
revoke all on function public.submit_signup_intent(jsonb) from public, anon;
grant execute on function public.submit_signup_intent(jsonb) to authenticated, service_role;
revoke all on function public.issue_email_proof_token(uuid) from public, anon, authenticated;
grant execute on function public.issue_email_proof_token(uuid) to service_role;
revoke all on function public.confirm_email_proof(text) from public, anon;
grant execute on function public.confirm_email_proof(text) to authenticated;
revoke all on function public.notification_outbox_claim(integer, uuid, text[]) from public, anon, authenticated;
grant execute on function public.notification_outbox_claim(integer, uuid, text[]) to service_role;
revoke all on function public.notification_outbox_done(bigint, text) from public, anon, authenticated;
grant execute on function public.notification_outbox_done(bigint, text) to service_role;

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

-- ─── D. Cases ─────────────────────────────────────────────────────────────────
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
    'owner', gen_random_uuid(), 'p1', gen_random_uuid(), 'p2', gen_random_uuid(),
    'e_owner', 'dryrun-owner-' || r8 || '@example.invalid', 'e_p1', 'dryrun-p1-' || r8 || '@example.invalid',
    'e_p2', 'dryrun-p2-' || r8 || '@example.invalid',
    'org_v', gen_random_uuid(), 'org_n', gen_random_uuid(), 'org_p', gen_random_uuid(),
    'code_v', 'DRYV' || upper(r8), 'code_n', 'DRYN' || upper(r8),
    'sec1', (select s.id from public.sectors s where s.is_active order by s.id limit 1),
    'sec2', (select s.id from public.sectors s where s.is_active order by s.id offset 1 limit 1));
  -- every case but the bare ones runs with account_signup_v2 on (production: off; rolled back)
  s0 := $s$update public.platform_settings set value = value || '{"account_signup_v2": true}'::jsonb where key = 'registration_flags';
select pg_temp.dr_user({owner}, {e_owner}, '{}', true, 'verified');
select pg_temp.dr_org({org_v}, 'Dryrun Zebramarina', 'verified', {owner}, {code_v});
select pg_temp.dr_org({org_n}, 'Dryrun Ownerless Yard', 'verified', null, {code_n});
select pg_temp.dr_org({org_p}, 'Dryrun Pending Docks', 'pending', null, null)$s$;
  s0 := s0 || $s$;
select pg_temp.dr_person({p1}, {e_p1}, '{"action": "none"}', false, 'pending')$s$;

  tests := jsonb_build_array(
    -- ── issue_email_proof_token (service role) ──
    jsonb_build_object('id', 'E01', 'who', 'service', 'expect', 'ret:43', 'label', 'a 43-character token; only its hash is stored, valid 24 h',
      'q', $q$select length(public.issue_email_proof_token({p1}) ->> 'token')::text$q$,
      'chk', $c$select count(*) = 1 and bool_and(email = {e_p1} and expires_at between now() + interval '23 hours' and now() + interval '25 hours' and octet_length(token_hash) = 32) from public.email_proof_token where user_id = {p1}$c$),
    jsonb_build_object('id', 'E02', 'who', 'service', 'expect', 'ret:already_proven', 'label', 'no token for a proven address',
      'setup', $s$update public.profiles set email_proven_at = now() where user_id = {p1}$s$,
      'q', $q$select public.issue_email_proof_token({p1}) ->> 'error'$q$),
    jsonb_build_object('id', 'E03', 'who', 'service', 'expect', 'ret:rate_limited', 'label', 'at most 3 tokens an hour',
      'setup', $s$select public.issue_email_proof_token({p1}); select public.issue_email_proof_token({p1}); select public.issue_email_proof_token({p1})$s$,
      'q', $q$select public.issue_email_proof_token({p1}) ->> 'error'$q$),
    -- ── confirm_email_proof (signed in) ──
    jsonb_build_object('id', 'E04', 'who', 'p1', 'expect', 'ret:true', 'label', 'the account''s own link, signed in with the password: proof stamped, token used, sign-up intent run (one e-mail queued)',
      'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', floor(extract(epoch from now()))))),
      'setup', $s$select set_config('dr.tok', public.issue_email_proof_token({p1}) ->> 'token', true)$s$,
      'q', $q$select public.confirm_email_proof(current_setting('dr.tok')) ->> 'stamped'$q$,
      'chk', $c$select (select email_proven_at is not null and signup_intent ? 'done_at' from public.profiles where user_id = {p1}) and (select used_at is not null from public.email_proof_token where user_id = {p1}) and (select count(*) = 1 from public.notification_outbox where user_id = {p1})$c$),
    jsonb_build_object('id', 'E05', 'who', 'p2', 'expect', 'ret:wrong_account', 'label', 'another account cannot use the link',
      'setup', $s$select pg_temp.dr_user({p2}, {e_p2}, '{}', false, 'pending'); select set_config('dr.tok', public.issue_email_proof_token({p1}) ->> 'token', true)$s$,
      'q', $q$select public.confirm_email_proof(current_setting('dr.tok')) ->> 'reason'$q$,
      'chk', $c$select count(*) = 2 from public.profiles where user_id in ({p1}, {p2}) and email_proven_at is null$c$),
    jsonb_build_object('id', 'E06', 'who', 'p1', 'expect', 'ret:expired', 'label', 'an expired link',
      'setup', $s$select set_config('dr.tok', public.issue_email_proof_token({p1}) ->> 'token', true); update public.email_proof_token set expires_at = now() - interval '1 minute' where user_id = {p1}$s$,
      'q', $q$select public.confirm_email_proof(current_setting('dr.tok')) ->> 'reason'$q$),
    jsonb_build_object('id', 'E07', 'who', 'p1', 'expect', 'ret:true/false', 'label', 'already proven: proven, nothing stamped again',
      'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', floor(extract(epoch from now()))))),
      'setup', $s$select set_config('dr.tok', public.issue_email_proof_token({p1}) ->> 'token', true); update public.profiles set email_proven_at = now() where user_id = {p1}$s$,
      'q', $q$select (r ->> 'proven') || '/' || (r ->> 'stamped') from (select public.confirm_email_proof(current_setting('dr.tok')) as r) x$q$),
    jsonb_build_object('id', 'E08', 'who', 'p1', 'expect', 'ret:email_changed', 'label', 'a link issued before an e-mail change proves nothing',
      'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', floor(extract(epoch from now()))))),
      'setup', $s$select set_config('dr.tok', public.issue_email_proof_token({p1}) ->> 'token', true); update public.profiles set email_changed_at = now() + interval '1 second' where user_id = {p1}$s$,
      'q', $q$select public.confirm_email_proof(current_setting('dr.tok')) ->> 'reason'$q$),
    jsonb_build_object('id', 'E09', 'who', 'p1', 'expect', 'ret:impersonation', 'label', 'an admin "view as user" session proves nothing',
      'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'magiclink', 'timestamp', floor(extract(epoch from now()))))),
      'setup', $s$select set_config('dr.tok', public.issue_email_proof_token({p1}) ->> 'token', true); insert into public.admin_impersonation_log (admin_user_id, target_user_id, target_email, created_at) values ({owner}, {p1}, {e_p1}, now())$s$,
      'q', $q$select public.confirm_email_proof(current_setting('dr.tok')) ->> 'reason'$q$),
    jsonb_build_object('id', 'E14', 'who', 'p1', 'expect', 'ret:password_session_required', 'label', 'a magic-link session proves the inbox only: nothing stamped, the link stays usable',
      'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'magiclink', 'timestamp', floor(extract(epoch from now()))))),
      'setup', $s$select set_config('dr.tok', public.issue_email_proof_token({p1}) ->> 'token', true)$s$,
      'q', $q$select public.confirm_email_proof(current_setting('dr.tok')) ->> 'reason'$q$,
      'chk', $c$select (select email_proven_at is null and not (signup_intent ? 'done_at') from public.profiles where user_id = {p1}) and (select used_at is null from public.email_proof_token where user_id = {p1}) and not exists (select 1 from public.notification_outbox where user_id = {p1})$c$),
    jsonb_build_object('id', 'E15', 'who', 'p1', 'expect', 'ret:password_session_required', 'label', 'a session with no amr at all proves nothing either',
      'setup', $s$select set_config('dr.tok', public.issue_email_proof_token({p1}) ->> 'token', true)$s$,
      'q', $q$select public.confirm_email_proof(current_setting('dr.tok')) ->> 'reason'$q$),
    jsonb_build_object('id', 'E10', 'who', 'p1', 'expect', 'ret:invalid_token', 'label', 'an unknown link',
      'q', $q$select public.confirm_email_proof('not-a-token-not-a-token-not-a-token') ->> 'reason'$q$),
    jsonb_build_object('id', 'E11', 'who', 'anon', 'bare', true, 'expect', 'rls', 'label', 'anon cannot confirm',
      'q', $q$select public.confirm_email_proof('not-a-token-not-a-token-not-a-token')::text$q$),
    jsonb_build_object('id', 'E12', 'who', 'p1', 'expect', 'rls', 'label', 'a person cannot mint a token for themself',
      'q', $q$select public.issue_email_proof_token({p1})::text$q$),
    jsonb_build_object('id', 'E13', 'who', 'p1', 'expect', 'rls', 'label', 'a person cannot read email_proof_token',
      'q', $q$select count(*)::text from public.email_proof_token$q$),
    -- ── notification_outbox ──
    jsonb_build_object('id', 'O01', 'who', 'service', 'expect', 'ret:1', 'label', 'claim the caller''s queued e-mail',
      'setup', $s$update public.profiles set email_proven_at = now() where user_id = {p1}; select public.complete_signup_for({p1})$s$,
      'q', $q$select count(*)::text from public.notification_outbox_claim(10, {p1}, array['account_under_review'])$q$,
      'chk', $c$select claimed_at is not null and attempts = 1 and sent_at is null from public.notification_outbox where user_id = {p1}$c$),
    jsonb_build_object('id', 'O02', 'who', 'service', 'expect', 'ret:0', 'label', 'a claimed e-mail is not handed out twice',
      'setup', $s$update public.profiles set email_proven_at = now() where user_id = {p1}; select public.complete_signup_for({p1}); select count(*) from public.notification_outbox_claim(10, {p1}, null)$s$,
      'q', $q$select count(*)::text from public.notification_outbox_claim(10, {p1}, null)$q$),
    jsonb_build_object('id', 'O03', 'who', 'service', 'expect', 'ret:true', 'label', 'marked sent once; a second mark says false',
      'setup', $s$update public.profiles set email_proven_at = now() where user_id = {p1}; select public.complete_signup_for({p1}); select set_config('dr.ob', (select id::text from public.notification_outbox where user_id = {p1}), true)$s$,
      'q', $q$select public.notification_outbox_done(current_setting('dr.ob')::bigint)::text$q$,
      'chk', $c$select sent_at is not null and not public.notification_outbox_done(current_setting('dr.ob')::bigint) from public.notification_outbox where user_id = {p1}$c$),
    jsonb_build_object('id', 'O04', 'who', 'p1', 'expect', 'ret:0', 'label', 'a person does not see the outbox (staff only)',
      'setup', $s$update public.profiles set email_proven_at = now() where user_id = {p1}; select public.complete_signup_for({p1})$s$,
      'q', $q$select count(*)::text from public.notification_outbox$q$),
    jsonb_build_object('id', 'O05', 'who', 'p1', 'expect', 'rls', 'label', 'a person cannot claim outbox rows',
      'q', $q$select count(*)::text from public.notification_outbox_claim(10, null, null)$q$),
    jsonb_build_object('id', 'O06', 'who', 'owner', 'expect', 'ret:true', 'label', 'a verified admin reads the outbox',
      'setup', $s$update public.profiles set persona = 'admin' where user_id = {owner}; update public.profiles set email_proven_at = now() where user_id = {p1}; select public.complete_signup_for({p1})$s$,
      'q', $q$select (count(*) >= 1)::text from public.notification_outbox where user_id = {p1}$q$),
    jsonb_build_object('id', 'C17', 'who', 'service', 'expect', 'ret:join_requested/mismatch', 'label', 'a code of another company than the one picked: the pick stands, the code claims nothing (one failed attempt)',
      'setup', $s$select pg_temp.dr_person({p2}, {e_p2}, jsonb_build_object('action', 'join', 'org_id', {org_v}, 'code', {code_n}), true, 'pending')$s$,
      'q', $q$select (r ->> 'path') || '/' || (r ->> 'code') from (select public.complete_signup_for({p2}) -> 'result' as r) x$q$,
      'chk', $c$select (select count(*) = 1 from public.organization_invitations where organization_id = {org_v} and email = {e_p2} and status = 'join_requested') and not exists (select 1 from public.organization_invitations where organization_id = {org_n} and email = {e_p2}) and (select count(*) = 1 from public.org_claim_attempt where user_id = {p2})$c$),
    jsonb_build_object('id', 'C18', 'who', 'service', 'expect', 'ret:claim_requested/matched', 'label', 'the code of the company picked: a claim with code_matched',
      'setup', $s$select pg_temp.dr_person({p2}, {e_p2}, jsonb_build_object('action', 'join', 'org_id', {org_n}, 'code', {code_n}), true, 'pending')$s$,
      'q', $q$select (r ->> 'path') || '/' || (r ->> 'code') from (select public.complete_signup_for({p2}) -> 'result' as r) x$q$,
      'chk', $c$select count(*) = 1 from public.organization_invitations where organization_id = {org_n} and email = {e_p2} and status = 'claim_requested' and code_matched$c$),
    jsonb_build_object('id', 'C19', 'who', 'service', 'expect', 'ret:join_requested', 'label', 'an owner of record who is not an owner member: request filed, no team_join_request queued (as send-notification)',
      'setup', $s$update public.organizations set owner_user_id = {p1} where id = {org_v}; select pg_temp.dr_person({p2}, {e_p2}, jsonb_build_object('action', 'join', 'org_id', {org_v}), true, 'pending')$s$,
      'q', $q$select public.complete_signup_for({p2}) -> 'result' ->> 'path'$q$,
      'chk', $c$select not exists (select 1 from public.notification_outbox where kind = 'team_join_request' and actor_id = {p2})$c$)
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

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (signup_identity dry run 3, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
