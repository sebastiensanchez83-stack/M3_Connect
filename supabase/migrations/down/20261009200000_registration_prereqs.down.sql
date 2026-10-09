-- UNDO of supabase/migrations/20261009200000_registration_prereqs.sql
-- Apply only AFTER the undo of 20261009210000_registration_core (checked below).
-- What it loses: the three platform_settings keys (flag positions, SLA text,
-- digest recipients) and the two canary events with any test rows on them.
-- On "canceling statement due to lock timeout": run it again a little later.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'gl_event' and column_name = 'engine') then
    raise exception 'registration_prereqs down: undo 20261009210000_registration_core first';
  end if;
end
$pre$;

-- 5. Canary events (their gl_guest and gl_email_log rows go with them: ON DELETE CASCADE).
delete from public.gl_event
 where slug in ('canary-onsite', 'canary-v2') and legacy_event_id is null and hidden;

-- 4. gl_event.hidden
alter table public.gl_event drop column if exists hidden;

-- 3. platform_settings
drop policy if exists platform_settings_private_keys on public.platform_settings;
delete from public.platform_settings where key in ('registration_flags', 'review_sla_text', 'review_digest_recipients');

-- 2. create_organization: the previous body (auto-verify for a verified creator) and ACL
--    (previous ACL: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}).
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

  -- Creator already vetted by M3 -> the org skips the review queue.
  SELECT (access_status = 'verified') INTO v_verified FROM public.profiles WHERE user_id = v_user_id;
  IF COALESCE(v_verified, false) THEN
    UPDATE public.organizations
       SET access_status = 'verified', onboarding_status = 'completed'
     WHERE id = v_org_id;
    PERFORM public.log_org_event(v_org_id, 'organization_auto_verified', jsonb_build_object('reason', 'creator already verified'));
  END IF;

  -- Log
  PERFORM public.log_org_event(v_org_id, 'organization_created', jsonb_build_object('name', p_name));

  RETURN v_org_id;
END;
$function$;
grant execute on function public.create_organization(text, text, text, text, text, text, text) to public, anon, authenticated, service_role;

-- 1. pg_trgm (refused if a Phase 2 index or function uses it: undo that first).
drop extension if exists pg_trgm;

-- Check: md5(prosrc) of create_organization = 4f6d46f8cef3b685ddceb138a8362bce
