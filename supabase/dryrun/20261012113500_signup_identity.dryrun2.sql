-- DRY RUN 2 of supabase/migrations/20261012113500_signup_identity.sql: more sign-up metadata and
-- complete_signup_for cases (claim codes, throttle, new company, verified person, open
-- invitation, recent decline) and submit_signup_intent / complete_my_signup. NOT A MIGRATION.
-- ONE query text, ONE execute_sql call, AFTER 20261012113000_signup_identity_orgs is applied.
-- Same harness as dry run 1. Ends with RAISE EXCEPTION 'DRYRUN ...'; everything rolls back.
-- Expected: "23 PASS, 0 FAIL".

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

  tests := jsonb_build_array(
    jsonb_build_object('id', 'C06', 'who', 'service', 'expect', 'ret:company_pending', 'label', 'company not verified yet: M3 decides, no row',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, jsonb_build_object('action', 'join', 'org_id', {org_p}), true, 'pending')$s$,
      'q', $q$select public.complete_signup_for({p1}) -> 'result' ->> 'path'$q$,
      'chk', $c$select not exists (select 1 from public.organization_invitations where email = {e_p1})$c$),
    jsonb_build_object('id', 'H05', 'who', 'postgres', 'expect', 'allow', 'label', 'malformed v2 keys never fail a sign-up (intent a string, sectors a string)',
      'q', $q$select pg_temp.dr_user({p1}, {e_p1}, '{"signup_intent": "join", "sector_ids": "x", "country": {"a": 1}}', false, 'pending')$q$,
      'chk', $c$select signup_intent is null and signup_source = 'account' from public.profiles where user_id = {p1}$c$),
    jsonb_build_object('id', 'H06', 'who', 'postgres', 'expect', 'allow', 'label', 'no metadata at all: individual, as today',
      'q', $q$insert into auth.users (id, email, aud, role) values ({p1}, {e_p1}, 'authenticated', 'authenticated')$q$,
      'chk', $c$select persona::text = 'individual' and first_name is null and onboarding_status::text = 'draft' from public.profiles where user_id = {p1}$c$),
    -- ── complete_signup_for (service role, as on_email_proven calls it) ──
    jsonb_build_object('id', 'C07', 'who', 'service', 'expect', 'ret:claim_requested/matched', 'label', 'claim code of a company with no owner: claim with code_matched, code consumed',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, jsonb_build_object('action', 'none', 'code', {code_n}), true, 'pending')$s$,
      'q', $q$select (r ->> 'path') || '/' || (r ->> 'code') from (select public.complete_signup_for({p1}) -> 'result' as r) x$q$,
      'chk', $c$select (select count(*) = 1 from public.organization_invitations where organization_id = {org_n} and email = {e_p1} and status = 'claim_requested' and code_matched) and not exists (select 1 from public.signup_claim_code where user_id = {p1})$c$),
    jsonb_build_object('id', 'C08', 'who', 'service', 'expect', 'ret:join_requested/refused_has_owner', 'label', 'claim code of a company WITH an owner: refused as a claim, the owner decides a join request',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, jsonb_build_object('action', 'none', 'code', {code_v}), true, 'pending')$s$,
      'q', $q$select (r ->> 'path') || '/' || (r ->> 'code') from (select public.complete_signup_for({p1}) -> 'result' as r) x$q$,
      'chk', $c$select not exists (select 1 from public.organization_invitations where email = {e_p1} and status = 'claim_requested')$c$),
    jsonb_build_object('id', 'C09', 'who', 'service', 'expect', 'ret:invalid', 'label', 'unknown code: counted in org_claim_attempt',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, '{"action": "none", "code": "NOPE-NOPE-0000"}', true, 'pending')$s$,
      'q', $q$select public.complete_signup_for({p1}) -> 'result' ->> 'code'$q$,
      'chk', $c$select count(*) = 1 from public.org_claim_attempt where user_id = {p1}$c$),
    jsonb_build_object('id', 'C10', 'who', 'service', 'expect', 'ret:throttled', 'label', '10 failed codes in the hour: the code is not even looked up',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, jsonb_build_object('action', 'none', 'code', {code_n}), true, 'pending'); insert into public.org_claim_attempt (user_id, attempted_at) select {p1}, now() from generate_series(1, 10)$s$,
      'q', $q$select public.complete_signup_for({p1}) -> 'result' ->> 'code'$q$,
      'chk', $c$select not exists (select 1 from public.organization_invitations where email = {e_p1})$c$),
    jsonb_build_object('id', 'C11', 'who', 'service', 'expect', 'ret:new_company', 'label', 'new company: no company row before M3 validates; the e-mail names it',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, '{"action": "new", "name": "Dryrun Brand New Marina", "type": "marina"}', true, 'pending')$s$,
      'q', $q$select public.complete_signup_for({p1}) -> 'result' ->> 'path'$q$,
      'chk', $c$select not exists (select 1 from public.organizations where name = 'Dryrun Brand New Marina') and (select data ->> 'org_name' = 'Dryrun Brand New Marina' from public.notification_outbox where user_id = {p1})$c$),
    jsonb_build_object('id', 'C12', 'who', 'service', 'expect', 'ret:none', 'label', 'a verified person gets no "under review" e-mail',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, '{"action": "none"}', true, 'verified')$s$,
      'q', $q$select public.complete_signup_for({p1}) -> 'result' ->> 'path'$q$,
      'chk', $c$select not exists (select 1 from public.notification_outbox where user_id = {p1})$c$),
    jsonb_build_object('id', 'C13', 'who', 'service', 'expect', 'ret:invitation_pending', 'label', 'an invitation already waits for the person: no new row',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, jsonb_build_object('action', 'join', 'org_id', {org_v}), true, 'pending'); insert into public.organization_invitations (organization_id, email, invited_by_user_id) values ({org_v}, {e_p1}, {owner})$s$,
      'q', $q$select public.complete_signup_for({p1}) -> 'result' ->> 'path'$q$,
      'chk', $c$select count(*) = 1 from public.organization_invitations where email = {e_p1}$c$),
    jsonb_build_object('id', 'C14', 'who', 'service', 'expect', 'ret:join_declined_recently', 'label', 'the owner declined within 30 days: no new request, no owner e-mail',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, jsonb_build_object('action', 'join', 'org_id', {org_v}), true, 'pending'); insert into public.organization_invitations (organization_id, email, status) values ({org_v}, {e_p1}, 'rejected')$s$,
      'q', $q$select public.complete_signup_for({p1}) -> 'result' ->> 'path'$q$,
      'chk', $c$select not exists (select 1 from public.notification_outbox where kind = 'team_join_request' and actor_id = {p1})$c$),
    jsonb_build_object('id', 'C15', 'who', 'service', 'expect', 'ret:flag_off', 'label', 'account_signup_v2 off: nothing runs, intent and claim code kept for later',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, jsonb_build_object('action', 'join', 'org_id', {org_v}, 'code', {code_n}), true, 'pending'); update public.platform_settings set value = value || '{"account_signup_v2": false}'::jsonb where key = 'registration_flags'$s$,
      'q', $q$select public.complete_signup_for({p1}) ->> 'reason'$q$,
      'chk', $c$select not exists (select 1 from public.organization_invitations where email = {e_p1}) and not exists (select 1 from public.notification_outbox where actor_id = {p1}) and exists (select 1 from public.signup_claim_code where user_id = {p1}) and (select onboarding_status::text = 'draft' and not (signup_intent ? 'done_at') from public.profiles where user_id = {p1})$c$),
    jsonb_build_object('id', 'C16', 'who', 'service', 'expect', 'ret:join_requested', 'label', 'an invitation past its expiry is not an open invitation: the join request is filed',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, jsonb_build_object('action', 'join', 'org_id', {org_v}), true, 'pending'); insert into public.organization_invitations (organization_id, email, invited_by_user_id, expires_at, created_at) values ({org_v}, {e_p1}, {owner}, now() - interval '1 day', now() - interval '31 days')$s$,
      'q', $q$select public.complete_signup_for({p1}) -> 'result' ->> 'path'$q$,
      'chk', $c$select count(*) = 1 from public.organization_invitations where email = {e_p1} and status = 'join_requested'$c$)
    ,
    -- ── submit_signup_intent / complete_my_signup ──
    jsonb_build_object('id', 'U01', 'who', 'anon', 'bare', true, 'expect', 'rls', 'label', 'anon cannot submit an intent',
      'q', $q$select public.submit_signup_intent('{"action": "none"}')::text$q$),
    jsonb_build_object('id', 'U02', 'who', 'owner', 'expect', 'err:already_in_company', 'label', 'a member of a company cannot file another',
      'q', $q$select public.submit_signup_intent('{"action": "new", "name": "Dryrun Second Co"}')::text$q$),
    jsonb_build_object('id', 'U03', 'who', 'p1', 'expect', 'ret:not_proven', 'label', 'unproven: stored (no raw code in profiles), runs once proven',
      'setup', $s$select pg_temp.dr_user({p1}, {e_p1}, '{}', false, 'pending')$s$,
      'q', $q$select public.submit_signup_intent(jsonb_build_object('action', 'join', 'org_id', {org_v}, 'code', 'ABC-999')) ->> 'reason'$q$,
      'chk', $c$select pr.signup_intent ->> 'action' = 'join' and pr.signup_intent ? 'submitted_at' and not (pr.signup_intent ? 'code') and (select code from public.signup_claim_code where user_id = {p1}) = 'ABC-999' from public.profiles pr where pr.user_id = {p1}$c$),
    jsonb_build_object('id', 'U04', 'who', 'p1', 'expect', 'ret:join_requested', 'label', 'proven: "Add my company" runs at once',
      'setup', $s$select pg_temp.dr_user({p1}, {e_p1}, '{}', true, 'pending')$s$,
      'q', $q$select public.submit_signup_intent(jsonb_build_object('action', 'join', 'org_id', {org_v})) -> 'result' ->> 'path'$q$),
    jsonb_build_object('id', 'U05', 'who', 'p1', 'expect', 'err:request_pending', 'label', 'one open join or claim request at a time',
      'setup', $s$select pg_temp.dr_user({p1}, {e_p1}, '{}', true, 'pending'); insert into public.organization_invitations (organization_id, email, status) values ({org_v}, {e_p1}, 'join_requested')$s$,
      'q', $q$select public.submit_signup_intent('{"action": "none"}')::text$q$),
    jsonb_build_object('id', 'U06', 'who', 'p1', 'expect', 'err:too_soon', 'label', 'one submission a minute',
      'setup', $s$select pg_temp.dr_user({p1}, {e_p1}, '{}', false, 'pending'); update public.profiles set signup_intent = jsonb_build_object('action', 'none', 'submitted_at', now()) where user_id = {p1}$s$,
      'q', $q$select public.submit_signup_intent('{"action": "none"}')::text$q$),
    jsonb_build_object('id', 'U07', 'who', 'p1', 'expect', 'ret:none', 'label', 'complete_my_signup runs the stored intent of the caller',
      'setup', $s$select pg_temp.dr_person({p1}, {e_p1}, '{"action": "none"}', true, 'pending')$s$,
      'q', $q$select public.complete_my_signup() -> 'result' ->> 'path'$q$),
    jsonb_build_object('id', 'U08', 'who', 'p1', 'expect', 'allow', 'label', 'a direct PATCH of signup_intent is silently ignored (profile guard)',
      'setup', $s$select pg_temp.dr_user({p1}, {e_p1}, '{}', true, 'pending')$s$,
      'q', $q$update public.profiles set signup_intent = '{"action": "join", "done_at": "2026-01-01"}' where user_id = {p1}$q$,
      'chk', $c$select signup_intent is null from public.profiles where user_id = {p1}$c$),
    jsonb_build_object('id', 'U09', 'who', 'p1', 'expect', 'err:flag_off', 'label', 'account_signup_v2 off: nothing stored',
      'setup', $s$select pg_temp.dr_user({p1}, {e_p1}, '{}', true, 'pending'); update public.platform_settings set value = value || '{"account_signup_v2": false}'::jsonb where key = 'registration_flags'$s$,
      'q', $q$select public.submit_signup_intent('{"action": "new", "name": "Dryrun Flag Off Co", "code": "ABC-777"}')::text$q$,
      'chk', $c$select (select signup_intent is null from public.profiles where user_id = {p1}) and not exists (select 1 from public.signup_claim_code where user_id = {p1})$c$),
    jsonb_build_object('id', 'U10', 'who', 'p1', 'expect', 'ret:none', 'label', 'a join request left unanswered past its expiry no longer blocks the person',
      'setup', $s$select pg_temp.dr_user({p1}, {e_p1}, '{}', true, 'pending'); insert into public.organization_invitations (organization_id, email, status, expires_at, created_at) values ({org_v}, {e_p1}, 'join_requested', now() - interval '1 day', now() - interval '31 days')$s$,
      'q', $q$select public.submit_signup_intent('{"action": "none"}') -> 'result' ->> 'path'$q$)
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

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (signup_identity dry run 2, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
