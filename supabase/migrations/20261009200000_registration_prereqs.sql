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
-- 2. create_organization(): the exact current body (md5-checked below) minus the
--    auto-verify block. A company created by a verified person now stays
--    'pending' like any other, until M3 verifies it. Nothing else changes:
--    signature, SECURITY DEFINER, search_path, owner.
--    EXECUTE is revoked from PUBLIC and anon (an anonymous caller could only fail:
--    auth.uid() is null). authenticated keeps it: the live sign-up wizard
--    (OnboardingPage, OrganizationTab) calls it. Revoking it from authenticated
--    is Phase 2 (spec §3.9), together with the new sign-up.
--    VISIBLE ON THE LIVE SITE (decided): a verified member who creates a company
--    from the old wizard gets a pending company. The old wizard still says
--    "Your company is set up and live" and marks the company onboarding
--    'completed'; staff find it in the companies list (status pending).
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
--                     20261009210000_registration_core
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
--                                                         -> 128d6edc3e572bf22792fa5dab433030
--   select has_function_privilege('anon', 'public.create_organization(text,text,text,text,text,text,text)', 'execute');  -> false
--   select key, value from platform_settings where key in ('registration_flags', 'review_sla_text');
--   select slug, hidden, requests_open, legacy_event_id from gl_event order by slug;
-- Dry run: supabase/dryrun/20261009200000_registration_prereqs.dryrun.sql
-- Undo:    supabase/migrations/down/20261009200000_registration_prereqs.down.sql

-- ─── 0. Preconditions ───────────────────────────────────────────────────────
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
     and v_md5 is distinct from '128d6edc3e572bf22792fa5dab433030' then
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
  -- stays 'pending' until staff verify it.

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
     'starts_at', to_char((date_trunc('day', now()) + interval '30 days 10 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
     'ends_at', to_char((date_trunc('day', now()) + interval '30 days 11 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
   true)
on conflict (slug) do nothing;
