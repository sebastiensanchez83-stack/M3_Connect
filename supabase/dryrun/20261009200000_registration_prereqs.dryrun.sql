-- DRY RUN of supabase/migrations/20261009200000_registration_prereqs.sql
-- NOTHING IS KEPT.
--
-- How to run: the WHOLE file in ONE execute_sql call (one implicit transaction).
-- Do not add BEGIN/COMMIT and do not run it statement by statement. The last
-- statement ends with RAISE EXCEPTION 'DRYRUN ...', so the migration and every
-- test write roll back; the error text IS the report ("n PASS, m FAIL" first,
-- then one line per check). Afterwards, check that nothing persisted:
--   select count(*) from platform_settings where key = 'registration_flags';   -> 0
--   select count(*) from gl_event where slug like 'canary-%';                    -> 0
--
-- Layout
--   A. snapshot (function ACLs, policies, SM26 fingerprint, wys26) before the body;
--   B. the migration body, verbatim (assembled from the migration file);
--   C. one DO block: structural checks (S..), then cases (C..). Each case runs in
--      its own sub-transaction as the simulated caller (set local role
--      anon/authenticated + request.jwt.claims), records its outcome, and is
--      rolled back before the next case starts.
--      Expectations: allow = no error (and >= 1 row written for a write);
--      rls = SQLSTATE 42501, or 0 rows written; err:<text> = an error containing
--      <text>; ret:<value> = the query returned exactly <value>.
--      chk = an extra query run as postgres after the case's statement, inside the
--      case, that must return true.
--
-- Callers: looked up at run time (no personal data in this file): the oldest
-- verified admin (staff), the oldest verified non-staff account with no company
-- (creates one), the oldest verified non-staff account (reader).
-- READ COMMITTED: the SM26 fingerprint is read twice in this transaction; a
-- concurrent SM26 write (none expected: SM26 is locked; sm_autoclaim_by_email
-- can still link an imported registration to a new account) would show as a
-- FAIL of S07; a WYS request sent during the run, as a FAIL of S09. Re-run.
-- Locks: lock_timeout 5 s (below and in the body). "canceling statement due to
-- lock timeout" = nothing was kept; run it again a little later.
-- Expected result: "25 PASS, 0 FAIL" (13 structural checks, 12 cases).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot ─────────────────────────────────────────────────────────────
create temp table _dryrun_before on commit drop as
  select 'acl ' || p.oid::regprocedure::text as k, coalesce(p.proacl::text, '') as v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
  union all
  select 'policy ' || schemaname || '.' || tablename || '.' || policyname,
         permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    from pg_policies
   where schemaname in ('public', 'storage');

create temp table _dryrun_sm26_before on commit drop as
  select 'sm_registration' as tbl, count(*) as n, md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as fp from public.sm_registration t
  union all select 'sm_role_assignment', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_role_assignment t
  union all select 'sm_attendee', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_attendee t
  union all select 'sm_badge', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_badge t
  union all select 'sm_payment', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_payment t
  union all select 'sm_invoice', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_invoice t
  union all select 'sm_networking_pass', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_networking_pass t;

create temp table _dryrun_wys_before on commit drop as
  select e.requests_open, e.capacity, e.settings, e.notify_email,
         (select md5(coalesce(string_agg(g::text, '|' order by g.id), '')) from public.gl_guest g where g.event_id = e.id) as guests_fp
    from public.gl_event e where e.slug = 'wys26';

-- ─── B. Migration body (verbatim) ───────────────────────────────────────────
-- Unified registration, Phase 0.7: prerequisites.
-- Spec: regspec-en.md §15 task 0.7 (and §3.9, §11, §13). Contract for the other
-- lanes: docs/registration-contract.md.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Production facts (read-only, 9 Oct 2026)
-- ════════════════════════════════════════════════════════════════════════════
-- * pg_trgm is available (1.6) but not installed. Extensions live in schema
--   "extensions" (pgcrypto, citext, uuid-ossp, ...); unaccent and pg_net sit in
--   public. pg_trgm goes to "extensions", like the others.
-- * create_organization() still AUTO-VERIFIES the new company when its creator's
--   profile is verified ("Creator already vetted by M3"). Victor, 6 Oct: M3
--   validates every company and every person (registration-harmonisation
--   decisions). Its EXECUTE is granted to PUBLIC and anon as well (=X/postgres).
-- * platform_settings is readable by ANYONE (policy "Anyone can read platform
--   settings", USING true) and writable by verified staff. Keys today:
--   display_stats, site_config.
-- * gl_event holds one row: wys26 (World Yachting Summit 2026).
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration changes
-- ════════════════════════════════════════════════════════════════════════════
-- 1. create extension pg_trgm in schema extensions (used by Phase 2 company
--    matching; nothing uses it yet).
-- 0. Lock and statement timeouts (set local): this file takes short exclusive
--    locks on platform_settings and gl_event (read by every visitor). If another
--    session holds them, it gives up after 5 s instead of queueing every request
--    of the live site behind it. "canceling statement due to lock timeout": just
--    run it again a little later (nothing was applied).
-- 2. create_organization(): the exact current body (md5-checked below) minus the
--    auto-verify block. A company created by a verified person now stays
--    'pending' like any other, until M3 verifies it, and the audit log gets an
--    'organization_pending_review' event (reason creator_verified) so the review
--    queue of Phase 3 can list those companies. Nothing else changes: signature,
--    SECURITY DEFINER, search_path, owner.
--    EXECUTE is revoked from PUBLIC and anon (an anonymous caller could only fail:
--    auth.uid() is null). authenticated keeps it: the live sign-up wizard
--    (OnboardingPage, OrganizationTab) calls it. Revoking it from authenticated
--    is Phase 2 (spec §3.9), together with the new sign-up.
--    VISIBLE ON THE LIVE SITE (decided): a verified member who creates a company
--    from the old wizard gets a pending company. The old wizard still says
--    "Your company is set up and live" and marks the company onboarding
--    'completed'. Nobody is alerted: until the review queue exists, staff look
--    at Admin > Companies (status pending) once a week; the registration-cron
--    digest (EDGE lane) also counts pending companies.
-- 3. platform_settings, three new keys (ON CONFLICT DO NOTHING, so an existing
--    value is never overwritten):
--      registration_flags        every switch of spec §13, all false
--      review_sla_text           "within 2 working days" (a JSON string)
--      review_digest_recipients  a JSON array of e-mail addresses, copied at
--                                apply time from the wys26 staff alert address
--                                (gl_event.notify_email), so no address is
--                                written in this public repository
--    plus a RESTRICTIVE select policy platform_settings_private_keys: the row
--    review_digest_recipients is readable by staff only (the table is otherwise
--    public, and that row holds e-mail addresses). Other rows are unchanged.
-- 4. gl_event.hidden boolean not null default false: a hidden event never
--    appears in a public list (public_registration_events, Phase 1); it is
--    reachable only by its slug. wys26 stays false.
-- 5. Two hidden canary events (spec §11), inserted only if their slug is free:
--      canary-onsite  guest-list engine (guest_list_v1 by default once Phase 1
--                     adds the engine column); door rehearsal and the
--                     guest-list contract tests (scripts/contract/guest-list.mjs)
--      canary-v2      becomes core_v2 / webinar / instant in
--                     20261009210000_registration_core. Fixed dates
--                     2027-06-30 10:00-11:00 UTC (settings.starts_at / ends_at),
--                     so it stays open through the 13-20 Nov rehearsal, WYS and
--                     the December work. To move them later (staff SQL):
--                     update gl_event set settings = settings || '{"starts_at":
--                     "...Z", "ends_at": "...Z"}' where slug = 'canary-v2';
--    Both: no legacy_event_id (no row in the public events catalogue), no staff
--    alert address, requests_open = FALSE. Deviation from spec §11
--    (requests_open = true): the contract script opens canary-onsite at the start
--    of a run and closes it at the end, so nobody can post requests to it in
--    between (guest-list answers any slug it knows).
--
-- NOT touched: guest-list (edge function), gl_guest, gl_checkin, wys26 data,
-- any sm_* row, auth settings.
--
-- Old live client (main): unchanged except the decided item in 2. It never
-- reads the new keys, never calls create_organization as anon, and does not
-- know the canary slugs.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select extname, extnamespace::regnamespace from pg_extension where extname = 'pg_trgm';      -> extensions
--   select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.create_organization(text,text,text,text,text,text,text)'::regprocedure;
--                                                         -> 6d5ac0be95f51ded1635d8f00bd2bf02
--   select has_function_privilege('anon', 'public.create_organization(text,text,text,text,text,text,text)', 'execute');  -> false
--   select key, value from platform_settings where key in ('registration_flags', 'review_sla_text');
--   select slug, hidden, requests_open, legacy_event_id from gl_event order by slug;
-- Dry run: supabase/dryrun/20261009200000_registration_prereqs.dryrun.sql
-- Undo:    supabase/migrations/down/20261009200000_registration_prereqs.down.sql

-- ─── 0. Timeouts and preconditions ──────────────────────────────────────────
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
begin
  -- create_organization: the body this file was built from (reviewed) or this
  -- file's own body (patched, on a re-run). chr(13) stripped: a CRLF working copy
  -- of this file must not look like drift.
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p
   where p.oid = 'public.create_organization(text, text, text, text, text, text, text)'::regprocedure;
  if v_md5 is distinct from '4f6d46f8cef3b685ddceb138a8362bce'
     and v_md5 is distinct from '6d5ac0be95f51ded1635d8f00bd2bf02' then
    raise exception 'registration_prereqs: create_organization changed since 9 Oct 2026 (md5 %); re-read it with pg_get_functiondef and rebuild this migration', v_md5;
  end if;

  if not exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    raise exception 'registration_prereqs: extension pg_trgm is not available on this server';
  end if;

  -- The canary slugs must not belong to a real event.
  if exists (select 1 from public.gl_event
              where slug in ('canary-onsite', 'canary-v2') and legacy_event_id is not null) then
    raise exception 'registration_prereqs: a canary slug is already used by a real event';
  end if;
end
$pre$;

-- ─── 1. pg_trgm ─────────────────────────────────────────────────────────────
create extension if not exists pg_trgm with schema extensions;

-- ─── 2. create_organization without auto-verification ──────────────────────
CREATE OR REPLACE FUNCTION public.create_organization(p_name text, p_organization_type text DEFAULT NULL::text, p_primary_domain text DEFAULT NULL::text, p_website text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id UUID;
  v_slug TEXT;
  v_user_id UUID := auth.uid();
  v_verified BOOLEAN;
BEGIN
  -- Check user isn't already in an org
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'User is already a member of an organization';
  END IF;

  -- Validate domain isn't public
  IF p_primary_domain IS NOT NULL AND public.is_public_email_domain(p_primary_domain) THEN
    RAISE EXCEPTION 'Public email domains cannot be used as organization domain';
  END IF;

  -- Generate slug
  v_slug := public.generate_org_slug(p_name);

  -- Create organization
  INSERT INTO public.organizations (name, slug, primary_domain, organization_type, created_by_user_id, owner_user_id, website, description, country, city)
  VALUES (p_name, v_slug, p_primary_domain, p_organization_type, v_user_id, v_user_id, p_website, p_description, p_country, p_city)
  RETURNING id INTO v_org_id;

  -- Add creator as owner member
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');

  -- No auto-verification (registration_prereqs, 9 Oct 2026): M3 validates every
  -- company, including one created by an already-verified person. The company
  -- stays 'pending' until staff verify it; the audit log marks it for review.
  SELECT (access_status = 'verified') INTO v_verified FROM public.profiles WHERE user_id = v_user_id;
  IF COALESCE(v_verified, false) THEN
    PERFORM public.log_org_event(v_org_id, 'organization_pending_review', jsonb_build_object('reason', 'creator_verified'));
  END IF;

  -- Log
  PERFORM public.log_org_event(v_org_id, 'organization_created', jsonb_build_object('name', p_name));

  RETURN v_org_id;
END;
$function$;

revoke execute on function public.create_organization(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, text, text) to authenticated, service_role;

-- ─── 3. platform_settings keys ──────────────────────────────────────────────
insert into public.platform_settings (key, value, label, description)
values
  ('registration_flags',
   jsonb_build_object(
     'webinar_v2', false, 'onsite_v2', false, 'front_door', false, 'account_signup_v2', false,
     'password_only_login', false, 'wys_form_v2', false, 'wys_status_edit', false,
     'review_queue', false, 'provisioning', false, 'capabilities_enforced', false, 'turnstile', false),
   'Registration switches',
   'Unified registration rollout switches (spec section 13). Read by the site and the registration edge functions. All off = the current behaviour.'),
  ('review_sla_text',
   to_jsonb('within 2 working days'::text),
   'Review delay promised to members',
   'Shown on screens and in e-mails: "M3 reviews your request <text>".'),
  ('review_digest_recipients',
   coalesce((select jsonb_build_array(btrim(g.notify_email))
               from public.gl_event g
              where g.slug = 'wys26' and nullif(btrim(g.notify_email), '') is not null),
            '[]'::jsonb),
   'Daily review digest recipients',
   'E-mail addresses that receive the 08:00 (Monaco) staff review digest. Staff only.')
on conflict (key) do nothing;

-- The table is public; this one row holds e-mail addresses.
drop policy if exists platform_settings_private_keys on public.platform_settings;
create policy platform_settings_private_keys on public.platform_settings
  as restrictive
  for select
  to public
  using (key <> 'review_digest_recipients' or public.is_moderator());

-- ─── 4. gl_event.hidden ─────────────────────────────────────────────────────
alter table public.gl_event add column if not exists hidden boolean not null default false;
comment on column public.gl_event.hidden is
  'Never listed publicly (test and canary events). Reachable only by slug. Added by registration_prereqs.';

-- ─── 5. Canary events (hidden, closed, no catalogue row) ────────────────────
insert into public.gl_event (slug, title, legacy_event_id, capacity, notify_email, requests_open, settings, hidden)
values
  ('canary-onsite', 'Canary on-site (internal test)', null, 20, null, false,
   jsonb_build_object(
     'tagline', 'Internal test event. Not a real event.',
     'intro', 'This page is used by the Smart Marina Connect team to test the guest list. It is not a real event.',
     'date_label', 'Test only',
     'venue', 'Test venue',
     'city', 'Monaco',
     'parts', jsonb_build_array(
       jsonb_build_object('key', 'conference', 'when', 'Daytime', 'label', 'Conference'),
       jsonb_build_object('key', 'gala', 'when', 'Evening', 'label', 'Gala dinner'))),
   true),
  ('canary-v2', 'Canary v2 (internal test)', null, 20, null, false,
   jsonb_build_object(
     'tagline', 'Internal test webinar. Not a real event.',
     'date_label', 'Test only',
     'venue', 'Online',
     -- No catalogue row: the registration core reads the dates from here.
     -- Fixed, after the rehearsal, WYS and December (see the header to move them).
     'starts_at', '2027-06-30T10:00:00Z',
     'ends_at', '2027-06-30T11:00:00Z'),
   true)
on conflict (slug) do nothing;

-- ─── C. Checks and cases ────────────────────────────────────────────────────
do $dryrun$
declare
  results text := '';
  n_pass integer := 0;
  n_fail integer := 0;
  c_staff uuid;
  c_maker uuid;
  c_reader uuid;
  r record;
  tests jsonb;
  t jsonb;
  v_uid uuid;
  v_dml boolean;
  v_ret text;
  v_n bigint;
  v_err text;
  v_state text;
  v_chk boolean;
  v_exp text;
  v_pass boolean;
begin
  -- Callers (read-only lookups).
  select p.user_id into c_staff from public.profiles p
   where p.persona = 'admin' and p.access_status = 'verified' order by p.created_at limit 1;
  select p.user_id into c_maker from public.profiles p
   where p.access_status = 'verified' and p.persona not in ('admin', 'moderator')
     and not exists (select 1 from public.organization_members m where m.user_id = p.user_id)
   order by p.created_at limit 1;
  select p.user_id into c_reader from public.profiles p
   where p.access_status = 'verified' and p.persona not in ('admin', 'moderator')
   order by p.created_at limit 1;
  if c_staff is null or c_reader is null then
    results := results || format(E'\nFAIL LOOKUP staff=%s reader=%s', c_staff, c_reader);
    n_fail := n_fail + 1;
  end if;
  if c_maker is null then
    results := results || E'\nINFO LOOKUP no verified non-staff account without a company: case C06 will fail';
  end if;

  -- ── Structural checks ──
  create temp table _dr_checks (id text, ok boolean, label text) on commit drop;
  insert into _dr_checks values
    ('S01', exists (select 1 from pg_extension where extname = 'pg_trgm' and extnamespace = 'extensions'::regnamespace),
     'pg_trgm installed in schema extensions'),
    ('S02', (select md5(replace(prosrc, chr(13), '')) from pg_proc
              where oid = 'public.create_organization(text, text, text, text, text, text, text)'::regprocedure)
            = '6d5ac0be95f51ded1635d8f00bd2bf02',
     'create_organization body = the patched body (no auto-verify, pending-review log)'),
    ('S03', not has_function_privilege('anon', 'public.create_organization(text, text, text, text, text, text, text)', 'execute')
            and has_function_privilege('authenticated', 'public.create_organization(text, text, text, text, text, text, text)', 'execute')
            and has_function_privilege('service_role', 'public.create_organization(text, text, text, text, text, text, text)', 'execute'),
     'create_organization: anon no, authenticated and service_role yes'),
    ('S04', (select count(*) from public.platform_settings
              where key in ('registration_flags', 'review_sla_text', 'review_digest_recipients')) = 3,
     'three platform_settings keys exist'),
    ('S05', (select (select count(*) from jsonb_each(value)) = 11
                    and not exists (select 1 from jsonb_each(value) f where f.value <> 'false'::jsonb)
               from public.platform_settings where key = 'registration_flags'),
     'registration_flags: 11 switches, all false'),
    ('S06', (select value = to_jsonb('within 2 working days'::text) from public.platform_settings where key = 'review_sla_text')
            and (select jsonb_typeof(value) = 'array' from public.platform_settings where key = 'review_digest_recipients'),
     'review_sla_text string, review_digest_recipients array'),
    ('S07', not exists (select tbl, n, fp from _dryrun_sm26_before
                        except
                        select 'sm_registration', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_registration t
                        union all select 'sm_role_assignment', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_role_assignment t
                        union all select 'sm_attendee', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_attendee t
                        union all select 'sm_badge', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_badge t
                        union all select 'sm_payment', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_payment t
                        union all select 'sm_invoice', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_invoice t
                        union all select 'sm_networking_pass', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sm_networking_pass t),
     'SM26 core tables unchanged (counts and content fingerprints)'),
    ('S08', (select count(*) = 2 and bool_and(hidden) and bool_and(not requests_open) and bool_and(legacy_event_id is null)
                    and bool_and(notify_email is null)
               from public.gl_event where slug in ('canary-onsite', 'canary-v2')),
     'two canaries: hidden, closed, no catalogue row, no staff alert'),
    ('S09', exists (select 1 from public.gl_event e, _dryrun_wys_before b
                     where e.slug = 'wys26' and not e.hidden
                       and e.requests_open = b.requests_open and e.capacity is not distinct from b.capacity
                       and e.settings = b.settings and e.notify_email is not distinct from b.notify_email
                       and (select md5(coalesce(string_agg(g::text, '|' order by g.id), '')) from public.gl_guest g where g.event_id = e.id) = b.guests_fp),
     'wys26 event and guests unchanged, not hidden'),
    ('S10', (select count(*) from (
               select k, v from _dryrun_before where k like 'policy %'
               except
               select 'policy ' || schemaname || '.' || tablename || '.' || policyname,
                      permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
                 from pg_policies where schemaname in ('public', 'storage')) x) = 0
            and (select count(*) from pg_policies where schemaname in ('public', 'storage'))
                = (select count(*) from _dryrun_before where k like 'policy %') + 1
            and exists (select 1 from pg_policies where policyname = 'platform_settings_private_keys' and permissive = 'RESTRICTIVE'),
     'no existing policy changed; exactly one added (platform_settings_private_keys, restrictive)'),
    ('S11', (select count(*) from (
               select k, v from _dryrun_before where k like 'acl %'
               except
               select 'acl ' || p.oid::regprocedure::text, coalesce(p.proacl::text, '')
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') x) = 1,
     'only one existing function ACL changed (create_organization)'),
    ('S12', (select column_default = 'false' and is_nullable = 'NO' from information_schema.columns
              where table_schema = 'public' and table_name = 'gl_event' and column_name = 'hidden'),
     'gl_event.hidden boolean not null default false'),
    ('S13', (select settings ->> 'starts_at' = '2027-06-30T10:00:00Z' and settings ->> 'ends_at' = '2027-06-30T11:00:00Z'
               from public.gl_event where slug = 'canary-v2')
            and (select (settings ->> 'starts_at')::timestamptz > now() from public.gl_event where slug = 'canary-v2'),
     'canary-v2 carries its fixed future dates in settings (30 June 2027)');
  for r in select * from _dr_checks order by id loop
    if coalesce(r.ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s', case when coalesce(r.ok, false) then 'PASS' else 'FAIL' end, r.id, r.label);
  end loop;

  -- ── Cases ──
  tests := jsonb_build_array(
    jsonb_build_object('id', 'C01', 'who', 'anon', 'expect', 'ret:1', 'label', 'anon reads registration_flags',
      'q', 'select count(*)::text from public.platform_settings where key = ''registration_flags'''),
    jsonb_build_object('id', 'C02', 'who', 'anon', 'expect', 'ret:0', 'label', 'anon cannot read review_digest_recipients',
      'q', 'select count(*)::text from public.platform_settings where key = ''review_digest_recipients'''),
    jsonb_build_object('id', 'C03', 'who', 'reader', 'expect', 'ret:0', 'label', 'a member cannot read review_digest_recipients',
      'q', 'select count(*)::text from public.platform_settings where key = ''review_digest_recipients'''),
    jsonb_build_object('id', 'C04', 'who', 'staff', 'expect', 'ret:1', 'label', 'staff read review_digest_recipients',
      'q', 'select count(*)::text from public.platform_settings where key = ''review_digest_recipients'''),
    jsonb_build_object('id', 'C05', 'who', 'anon', 'expect', 'rls', 'label', 'anon cannot call create_organization',
      'q', 'select public.create_organization(''Dry run company'')::text'),
    jsonb_build_object('id', 'C06', 'who', 'maker', 'expect', 'allow', 'label', 'a verified member creates a company: it stays pending, flagged for review',
      'q', 'select public.create_organization(''Dry run company'', ''partner'')::text',
      'chk', format('select (select count(*) from public.organizations o
                               where o.created_by_user_id = %1$L and o.name = ''Dry run company'' and o.access_status = ''pending'') = 1
                       and not exists (select 1 from public.organization_audit_log l
                                         join public.organizations o on o.id = l.organization_id
                                        where o.created_by_user_id = %1$L and o.name = ''Dry run company''
                                          and l.event_type = ''organization_auto_verified'')
                       and exists (select 1 from public.organization_audit_log l
                                     join public.organizations o on o.id = l.organization_id
                                    where o.created_by_user_id = %1$L and o.name = ''Dry run company''
                                      and l.event_type = ''organization_pending_review'')', c_maker)),
    jsonb_build_object('id', 'C07', 'who', 'staff', 'expect', 'allow', 'label', 'staff can switch a registration flag',
      'q', 'update public.platform_settings set value = value || ''{"webinar_v2": true}''::jsonb where key = ''registration_flags'''),
    jsonb_build_object('id', 'C08', 'who', 'reader', 'expect', 'rls', 'label', 'a member cannot switch a flag',
      'q', 'update public.platform_settings set value = value || ''{"webinar_v2": true}''::jsonb where key = ''registration_flags'''),
    jsonb_build_object('id', 'C09', 'who', 'anon', 'expect', 'rls', 'label', 'anon cannot switch a flag',
      'q', 'update public.platform_settings set value = value || ''{"webinar_v2": true}''::jsonb where key = ''registration_flags'''),
    jsonb_build_object('id', 'C10', 'who', 'service', 'expect', 'ret:2', 'label', 'guest-list (service role) reads the canaries like any event',
      'q', 'select count(*)::text from public.gl_event where slug in (''canary-onsite'', ''canary-v2'') and title is not null and settings is not null'),
    jsonb_build_object('id', 'C11', 'who', 'reader', 'expect', 'ret:0', 'label', 'a member cannot read gl_event (canaries included)',
      'q', 'select count(*)::text from public.gl_event'),
    jsonb_build_object('id', 'C12', 'who', 'anon', 'expect', 'ret:2', 'label', 'anon still reads the other settings rows (display_stats, site_config)',
      'q', 'select count(*)::text from public.platform_settings where key in (''display_stats'', ''site_config'')')
  );

  for t in select * from jsonb_array_elements(tests) loop
    v_uid := case t ->> 'who' when 'staff' then c_staff when 'maker' then c_maker when 'reader' then c_reader end;
    v_dml := lower(left(ltrim(t ->> 'q'), 6)) in ('insert', 'update', 'delete');
    v_ret := null; v_n := null; v_err := null; v_state := null; v_chk := null;
    begin
      perform set_config('request.jwt.claim.sub', '', true);
      if t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
        set local role service_role;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      if v_dml then
        execute t ->> 'q';
        get diagnostics v_n = row_count;
      else
        execute t ->> 'q' into v_ret;
      end if;
      reset role;
      if coalesce(t ->> 'chk', '') <> '' then
        execute t ->> 'chk' into v_chk;
      end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := sqlerrm; v_state := sqlstate;
    end;

    v_exp := t ->> 'expect';
    v_pass := coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'rls'   then v_state = '42501' or (v_err is null and v_dml and v_n = 0)
                when v_exp like 'err:%' then strpos(v_err, substr(v_exp, 5)) > 0
                when v_exp like 'ret:%' then v_err is null and v_ret is not distinct from substr(v_exp, 5)
              end, false)
              and (coalesce(t ->> 'chk', '') = '' or v_chk is true);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s: %s | expect %s | %s%s',
      case when v_pass then 'PASS' else 'FAIL' end, t ->> 'id', t ->> 'who', t ->> 'label', v_exp,
      left(case when v_err is not null then format('error %s: %s', v_state, v_err)
                when v_dml then v_n || ' row(s) written'
                else 'returned ' || coalesce(v_ret, 'null') end, 300),
      case when coalesce(t ->> 'chk', '') <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (registration_prereqs, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
