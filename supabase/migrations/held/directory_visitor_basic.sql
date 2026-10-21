-- HELD for the go-live of the redesign (DAY D, D6: right after the redesign replaces main, never
-- before): NOT a normal migration. Go-live runbook P4; Victor's answers of 21 Oct 2026.
-- SUPERSEDES held/directory_signed_in_only.sql (its two statements are items 3 and 4 below);
-- that file is kept for the record and marked superseded. Apply THIS one, never both.
-- Down: supabase/migrations/down/directory_visitor_basic.down.sql
-- Dry runs: supabase/dryrun/directory_visitor_basic.dryrun.sql (this file, cases, then the down,
-- in one rolled-back transaction) and supabase/dryrun/directory_visitor_basic.down.dryrun.sql.
--
-- What a signed-out visitor may read, enforced by the database ("Les visiteurs voient juste des
-- informations basiques ... pour voir le reste, il faut etre connecte", with Q1 = C "generous"):
--   PUBLIC (anon keeps): a company's name, logo, cover, type, city / country, headquarters,
--     sectors, full description and media audience, badges (verified = is_claimed, sponsor tier,
--     award winner), member COUNT (org_public_member_counts), website, gallery, investment terms,
--     confirmed recommendations (reference_requests: client, country, project; never the signer's
--     e-mail, see 20261021120000), a marina's key figures (status, berths, superyacht berths,
--     longest berth, certifications: through org_public_highlights), the FIRST block of the Smart
--     Marina 2026 texts (org_public_highlights), and the counts of what is locked
--     (org_visitor_teaser).
--   MEMBERS ONLY (an account M3 validated, Q2 = b): the team (who, names), sending a message, a
--     marina's facilities and two texts, its purchase projects, the rest of the Smart Marina 2026
--     texts and the marinas' evidence images.
--   NEVER for visitors (internal to M3): primary_domain, max_seats, created_by_user_id,
--     owner_user_id, onboarding_status, rejection_reason, auto_approve_domain_joins,
--     social_media_links, marina_subtype (claim_code is already granted to nobody).
--   Companies M3 has not validated (12 pending and 1 suspended on 21 Oct 2026) are INVISIBLE to
--   visitors (Q5 = a); the 6 copies merged into another company stay readable, only so that their
--   old address redirects. Signed-in accounts still see pending companies, as today.
--   The webinar meeting link (events.meeting_url) is no longer readable signed out (Q10 = a).
--
-- What this file does NOT do (Victor, 21 Oct 2026, Q9 = "December"):
--   - signed-in accounts keep the same 37 organizations columns as today, the internal ones
--     included: column grants are per role, so an account M3 has not validated can still read
--     what the screens hide from it (website, gallery and investment terms are public anyway).
--     Closing them needs an own-company-or-staff function and its callers moved first (§7).
--   - for the same reason an account M3 has not validated can still list a company's members
--     (organization_members, user ids only: the onboarding join flow reads them) and call
--     get_public_profile(s), org_sm26_showcase and sm_org_marina_submission. The screens give it
--     the visitor version. The row tables that CAN tell validated accounts apart do: marina
--     details, purchase projects and media details need public.is_verified().
--   - reference_requests does not change here (recommendations stay public, Q1 = C).
--   - the gallery photos, logos and covers stay in the public org-logos bucket, which anyone can
--     list: the column gate hides the list of a hidden company, not the files (accepted: they are
--     marketing photos).
--
-- WHY HELD: the live main reads these signed out, checked on 21 Oct 2026. Applied while main is
-- live, main BREAKS for every visitor and for Googlebot (one refused column turns the whole read
-- into 42501):
--   - company pages show "Organisation not found" (OrganizationPublicPage.tsx:305-309, the
--     33-column read names primary_domain, owner_user_id...);
--   - the events page fails signed out (EventsPage.tsx:123, select('*') names meeting_url);
--   - /users/:id is blank (UserProfilePage.tsx:65, get_public_profile);
--   - the sign-up form stops recognising company domains (SignupForm.tsx:175-177);
--   - member counts read 0 in the directory and on company pages (organization_members);
--   - the marinas' Smart Marina 2026 texts disappear (SM26MarinaSustainability.tsx:50).
-- The redesign reads none of these signed out (rf-visitor, 21 Oct 2026): it reads is_claimed,
-- the visitor column lists of src/lib/orgVisibility.ts, org_visitor_teaser, org_public_highlights
-- and org_by_email_domain, and explicit event columns without meeting_url.
-- Rollback (§8): this file's down runs BEFORE main is published again.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_missing text;
  v_anon_cols text;
  v_expected_cols constant text := 'access_status,archived_at,audience_description,auto_approve_domain_joins,banner_url,city,country,created_at,created_by_user_id,description,duplicate_of,featured_partner,gallery,headquarters_country,id,investment_geographies,investment_hold_period,investment_size_max,investment_size_min,investment_thesis,is_claimed,is_event_media_partner,logo_url,marina_subtype,max_seats,name,name_search,onboarding_status,organization_type,owner_user_id,primary_domain,rejection_reason,slug,social_media_links,tier,updated_at,website';
begin
  -- 1. What the redesign reads instead must be there first (runbook P2).
  select string_agg(f, ', ') into v_missing
    from unnest(array['public.org_public_member_counts(uuid[])', 'public.org_visitor_teaser(uuid)', 'public.org_public_highlights(uuid)',
                      'public.org_by_email_domain(text)', 'public.org_award_wins()', 'public.is_verified()', 'public.is_moderator()']) as f
   where to_regprocedure(f) is null or not has_function_privilege('anon', f, 'execute');
  if v_missing is not null then
    raise exception 'directory_visitor_basic: missing or not callable by anon: % (apply the P2 files first)', v_missing;
  end if;
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'is_claimed')
     or not has_column_privilege('anon', 'public.organizations', 'is_claimed', 'select') then
    raise exception 'directory_visitor_basic: organizations.is_claimed is missing or not readable by anon (apply 20261021140000 first)';
  end if;
  -- 2. Every grant and policy below still has its 21 Oct 2026 shape.
  select string_agg(a.attname::text, ',' order by a.attname::text) into v_anon_cols
    from pg_attribute a
   where a.attrelid = 'public.organizations'::regclass and a.attnum > 0 and not a.attisdropped
     and exists (select 1 from aclexplode(a.attacl) x where x.grantee = 'anon'::regrole and x.privilege_type = 'SELECT');
  if v_anon_cols is distinct from v_expected_cols then
    raise exception 'directory_visitor_basic: the anon column grants of organizations changed; rebuild this file (now: %)', v_anon_cols;
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organizations'
                  and p.policyname = 'org_select_public' and p.roles = '{anon}'::name[] and p.cmd = 'SELECT' and p.qual = 'true') then
    raise exception 'directory_visitor_basic: org_select_public changed; rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
                  and p.policyname = 'org_members_select_public' and p.roles = '{anon}'::name[] and p.cmd = 'SELECT' and p.qual = 'true')
     or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
                     and p.policyname = 'org_members_select_auth' and p.roles = '{authenticated}'::name[] and p.qual = 'true') then
    raise exception 'directory_visitor_basic: org_members_select_public / org_members_select_auth changed (or the superseded directory_signed_in_only.sql was applied); rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_marina_details'
                  and p.policyname = 'marina_details_public_read' and p.roles = '{public}'::name[] and p.cmd = 'SELECT'
                  and regexp_replace(p.qual, '[[:space:]]+', ' ', 'g')
                      = '(EXISTS ( SELECT 1 FROM organizations o WHERE ((o.id = organization_marina_details.organization_id) AND (o.access_status = ''verified''::text))))')
     or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_marina_details'
                     and p.policyname = 'marina_details_member_read') then
    raise exception 'directory_visitor_basic: marina_details_public_read / marina_details_member_read changed; rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_future_plans'
                  and p.policyname = 'ofp_public_read' and p.roles = '{public}'::name[] and p.cmd = 'SELECT' and p.qual = 'true')
     or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_future_plans'
                     and p.policyname = 'ofp_owner_write' and p.cmd = 'ALL') then
    raise exception 'directory_visitor_basic: ofp_public_read / ofp_owner_write changed; rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_media_details'
                  and p.policyname = 'org_media_details_read' and p.roles = '{public}'::name[] and p.cmd = 'SELECT' and p.qual = 'true') then
    raise exception 'directory_visitor_basic: org_media_details_read changed; rebuild this file';
  end if;
  if (select count(*) from pg_policies p
       where p.schemaname = 'public' and p.roles = '{anon}'::name[] and p.cmd = 'SELECT'
         and ((p.tablename = 'partner_profiles' and p.policyname = 'partner_profiles_anon_public'
               and regexp_replace(p.qual, '[[:space:]]+', ' ', 'g')
                   = '(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.user_id = partner_profiles.user_id) AND (p.access_status = ''verified''::access_status_enum))))')
           or (p.tablename = 'media_partner_profiles' and p.policyname = 'media_partner_profiles_anon_public'
               and regexp_replace(p.qual, '[[:space:]]+', ' ', 'g')
                   = '(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.user_id = media_partner_profiles.user_id) AND (p.access_status = ''verified''::access_status_enum))))'))) <> 2 then
    raise exception 'directory_visitor_basic: partner_profiles_anon_public / media_partner_profiles_anon_public changed; rebuild this file';
  end if;
  if not exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) x
                  where c.oid = 'public.events'::regclass and x.grantee = 'anon'::regrole and x.privilege_type = 'SELECT')
     or (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'events') <> 28
     or (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'events'
          and c.column_name in ('id', 'title', 'description', 'date_time', 'location', 'language', 'access_level', 'speakers',
                                'replay_url', 'created_at', 'pdf_url', 'fees', 'max_attendance', 'location_details', 'event_type',
                                'event_website_url', 'event_partners', 'brochure_url', 'invitation_only', 'is_full_day',
                                'end_date_time', 'published', 'image_url', 'title_search', 'slug', 'slug_auto', 'slug_public',
                                'meeting_url')) <> 28 then
    raise exception 'directory_visitor_basic: the events columns or anon''s table SELECT changed; rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
                  and p.policyname = 'event_media_marina_evidence_public_read' and p.roles = '{anon,authenticated}'::name[] and p.cmd = 'SELECT') then
    raise exception 'directory_visitor_basic: event_media_marina_evidence_public_read changed; rebuild this file';
  end if;
  if not exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = 'public.get_public_profile(uuid)'::regprocedure)) x where x.grantee = 0)
     or not exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = 'public.org_member_count(uuid)'::regprocedure)) x where x.grantee = 0)
     or exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = 'public.sm_org_marina_submission(uuid)'::regprocedure)) x where x.grantee = 0)
     or exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = 'public.org_sm26_showcase(uuid)'::regprocedure)) x where x.grantee = 0)
     or not has_function_privilege('anon', 'public.sm_org_marina_submission(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.org_sm26_showcase(uuid)', 'execute') then
    raise exception 'directory_visitor_basic: the EXECUTE grants of get_public_profile / org_member_count / sm_org_marina_submission / org_sm26_showcase changed; rebuild this file';
  end if;
end
$pre$;

-- 1. organizations: visitors lose the internal columns (28 of 37 stay readable).
revoke select (primary_domain, max_seats, created_by_user_id, owner_user_id, onboarding_status, rejection_reason,
               auto_approve_domain_joins, social_media_links, marina_subtype)
  on public.organizations from anon;

-- 2. organizations: a company M3 has not validated is invisible to visitors; a merged copy stays
--    readable for its redirect. Signed-in accounts keep org_select_auth (every row).
alter policy org_select_public on public.organizations
  using (access_status = 'verified' or duplicate_of is not null);

-- 3. The team: visitors no longer read who belongs to a company (the count stays public through
--    org_public_member_counts). Signed-in accounts keep org_members_select_auth.
drop policy org_members_select_public on public.organization_members;

-- 4. Marina details: validated accounts only (their own members keep marina_details_member_read).
--    Visitors get the key figures from org_public_highlights.
alter policy marina_details_public_read on public.organization_marina_details
  to authenticated
  using ((select public.is_verified())
         and exists (select 1 from public.organizations o
                      where o.id = organization_marina_details.organization_id and o.access_status = 'verified'));

-- 5. Purchase projects: validated accounts only (their own members keep ofp_owner_write).
alter policy ofp_public_read on public.organization_future_plans
  to authenticated
  using ((select public.is_verified()));

-- 6. Media details (press_contact_email): validated accounts only (members keep org_media_details_write).
alter policy org_media_details_read on public.organization_media_details
  to authenticated
  using ((select public.is_verified()));

-- 7. Partner and media cards (0 rows on 21 Oct 2026): no anon read any more; owners and staff keep theirs.
drop policy partner_profiles_anon_public on public.partner_profiles;
drop policy media_partner_profiles_anon_public on public.media_partner_profiles;

-- 8. Events: visitors read every column but the webinar meeting link (signed-in accounts keep it).
revoke select on public.events from anon;
grant select (id, title, description, date_time, location, language, access_level, speakers, replay_url, created_at,
              pdf_url, fees, max_attendance, location_details, event_type, event_website_url, event_partners,
              brochure_url, invitation_only, is_full_day, end_date_time, published, image_url, title_search, slug,
              slug_auto, slug_public)
  on public.events to anon;

-- 9. Functions visitors no longer call. get_public_profile and org_member_count carry a PUBLIC
--    entry: revoking anon alone would change nothing.
revoke execute on function public.get_public_profile(uuid) from public, anon;
grant execute on function public.get_public_profile(uuid) to authenticated, service_role;
revoke execute on function public.org_member_count(uuid) from public, anon;
grant execute on function public.org_member_count(uuid) to authenticated, service_role;
revoke execute on function public.sm_org_marina_submission(uuid) from anon;
revoke execute on function public.org_sm26_showcase(uuid) from anon;

-- 10. The marinas' Smart Marina 2026 evidence images: signed-in accounts only.
alter policy event_media_marina_evidence_public_read on storage.objects to authenticated;
