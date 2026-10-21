-- DRY RUN of the DOWN of supabase/migrations/held/directory_visitor_basic.sql. NOT A MIGRATION.
-- ONE execute_sql call, after the five P2 files and BEFORE the held file (or, in a rollback, to
-- check the down before running it): a snapshot of every grant, policy and public function body
-- the held file touches, the held file verbatim, then the mistake the down must survive (the
-- superseded directory_signed_in_only down run after the held file: org_members_select_public is
-- back), the down verbatim, then every grant, policy and function body must be the same set as in
-- the snapshot and main's signed-out reads must answer again.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "8 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot: every grant and policy the file touches, order-insensitive ────────────────────
create function pg_temp.dr_state() returns table (k text, v text) language sql as $f$
  select 'policies', md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname, pl.roles, pl.cmd,
                                                    coalesce(pl.qual, ''), coalesce(pl.with_check, '')) || '|' || pl.permissive, ';'
                                             order by pl.schemaname, pl.tablename, pl.policyname), ''))
    from pg_policies pl where pl.schemaname in ('public', 'storage')
  union all
  select 'organizations columns', md5(coalesce(string_agg(a.attname::text || ':' || x.grantee::regrole::text || ':' || x.privilege_type, ','
                                                          order by a.attname::text, x.grantee::regrole::text, x.privilege_type), ''))
    from pg_attribute a cross join lateral aclexplode(a.attacl) x
   where a.attrelid = 'public.organizations'::regclass and a.attnum > 0 and not a.attisdropped
  union all
  select 'events columns', md5(coalesce(string_agg(a.attname::text || ':' || x.grantee::regrole::text || ':' || x.privilege_type, ','
                                                   order by a.attname::text, x.grantee::regrole::text, x.privilege_type), ''))
    from pg_attribute a cross join lateral aclexplode(a.attacl) x
   where a.attrelid = 'public.events'::regclass and a.attnum > 0 and not a.attisdropped
  union all
  select 'table grants', md5(coalesce(string_agg(c.relname::text || ':' || x.grantee::regrole::text || ':' || x.privilege_type, ','
                                                 order by c.relname::text, x.grantee::regrole::text, x.privilege_type), ''))
    from pg_class c cross join lateral aclexplode(c.relacl) x
   where c.oid in ('public.organizations'::regclass, 'public.organization_members'::regclass, 'public.organization_marina_details'::regclass,
                   'public.organization_future_plans'::regclass, 'public.organization_media_details'::regclass,
                   'public.partner_profiles'::regclass, 'public.media_partner_profiles'::regclass, 'public.events'::regclass)
  union all
  select 'function grants', md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || x.grantee::regrole::text || ':' || x.privilege_type
                                                    || ':' || x.grantor::regrole::text || ':' || x.is_grantable::text, ','
                                                    order by p.oid::regprocedure::text, x.grantee::regrole::text, x.privilege_type), ''))
    from pg_proc p cross join lateral aclexplode(p.proacl) x
   where p.pronamespace = 'public'::regnamespace
  union all
  select 'function bodies', md5(coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proconfig, ';'), '')
                                                    || ':' || p.prosecdef::text || ':' || p.provolatile::text, ','
                                                    order by p.oid::regprocedure::text), ''))
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_state();
create temp table _dr_pol_rows on commit drop as
  select pl.schemaname::text as s, pl.tablename::text as t, pl.policyname::text as p, pl.roles::text as r, pl.cmd as c,
         coalesce(pl.qual, '') as q, coalesce(pl.with_check, '') as w, pl.permissive as pm
    from pg_policies pl where pl.schemaname in ('public', 'storage');
create temp table _dr_fn_rows on commit drop as
  select p.oid::regprocedure::text as fn,
         coalesce((select string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' order by x.grantee::regrole::text, x.privilege_type)
                     from aclexplode(p.proacl) x), '') as acl
    from pg_proc p where p.pronamespace = 'public'::regnamespace;
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create function pg_temp.chk(p_ok boolean, p_label text) returns void language sql as $f$
  insert into _dr_res (ok, label) values (coalesce(p_ok, false), p_label);
$f$;

-- Runs one query (one text column) as anon or as a signed-in account and returns 'ok:<value>' or
-- 'err:<sqlstate>:<message>'. The error is caught around the query only; the caller asserts after.
create function pg_temp.dr_as(p_who text, p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  if p_who = 'anon' then
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
  elsif p_who = 'authenticated' then
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  else
    raise exception 'dr_as: unknown caller %', p_who;
  end if;
  begin
    execute p_sql into v_out;
    v_out := 'ok:' || coalesce(v_out, 'null');
  exception when others then
    v_out := 'err:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end
$f$;

-- ─── B. The held file, verbatim ──────────────────────────────────────────────────────────────────
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
--   old address redirects. Signed-in accounts still see pending companies, as today. What hangs
--   off a hidden company follows it for visitors (privacy review of 21 Oct 2026): its sectors
--   (organization_service_sectors / organization_interest_sectors, 11 such companies on 21 Oct
--   2026), its confirmed recommendations (reference_requests, 0 rows that day) and its award wins
--   (org_award_wins, 0 that day).
--   The webinar meeting link (events.meeting_url) is no longer readable signed out (Q10 = a).
--   "Validated account" in a policy is public.is_verified(null::public.persona_enum): the
--   no-argument call public.is_verified() is ambiguous on production (is_verified() and
--   is_verified(persona_enum default null) both exist: 42725), so it is never written here.
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
--     details, purchase projects and media details need a validated account.
--   - recommendations stay public (Q1 = C): reference_requests only loses, for visitors, the rows
--     of a company they cannot see (its column grants are 20261021120000's, unchanged here).
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
--   - the marinas' Smart Marina 2026 texts disappear (SM26MarinaSustainability.tsx:50);
--   - its invitation sign-up page reads the inviting company's type directly (JoinPage.tsx:226):
--     for a company M3 has not validated it finds nothing and gives the persona 'marina'.
-- The redesign reads none of these signed out (rf-visitor, 21 Oct 2026): it reads is_claimed,
-- the visitor column lists of src/lib/orgVisibility.ts, org_visitor_teaser, org_public_highlights,
-- org_by_email_domain and org_type_for_invitation, and explicit event columns without meeting_url.
-- Rollback (§8): this file's down runs BEFORE main is published again.
-- Items 11 to 13 only drop, for visitors, rows that belong to companies they cannot see.

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
                      'public.org_by_email_domain(text)', 'public.org_type_for_invitation(uuid)', 'public.org_award_wins()',
                      'public.is_verified(public.persona_enum)', 'public.is_moderator()']) as f
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
                  and p.policyname = 'org_select_public' and p.roles = '{anon}'::name[] and p.cmd = 'SELECT' and p.qual = 'true')
     or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organizations'
                     and p.policyname = 'org_select_auth' and p.roles = '{authenticated}'::name[] and p.cmd = 'SELECT' and p.qual = 'true') then
    raise exception 'directory_visitor_basic: org_select_public / org_select_auth changed; rebuild this file';
  end if;
  -- Items 11 and 12: the sectors and recommendations policies, as on 21 Oct 2026.
  if (select count(*) from pg_policies p
       where p.schemaname = 'public' and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
         and ((p.tablename = 'organization_service_sectors' and p.policyname = 'oss_public_read' and p.roles = '{public}'::name[] and p.qual = 'true')
           or (p.tablename = 'organization_interest_sectors' and p.policyname = 'ois_public_read' and p.roles = '{public}'::name[] and p.qual = 'true')
           or (p.tablename = 'reference_requests' and p.policyname = 'reference_requests_public_select_confirmed'
               and p.roles = '{anon,authenticated}'::name[] and p.qual = '(status = ''confirmed''::text)'))) <> 3 then
    raise exception 'directory_visitor_basic: oss_public_read / ois_public_read / reference_requests_public_select_confirmed changed; rebuild this file';
  end if;
  -- Item 13: org_award_wins() as created by 20261020130000 (its down restores that body).
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'public.org_award_wins()'::regprocedure) is distinct from '4b6a7cbe7a2f83f3d190abd65d5964e2' then
    raise exception 'directory_visitor_basic: org_award_wins() is not the 20261020130000 body; rebuild this file';
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
  using ((select public.is_verified(null::public.persona_enum))
         and exists (select 1 from public.organizations o
                      where o.id = organization_marina_details.organization_id and o.access_status = 'verified'));

-- 5. Purchase projects: validated accounts only (their own members keep ofp_owner_write).
alter policy ofp_public_read on public.organization_future_plans
  to authenticated
  using ((select public.is_verified(null::public.persona_enum)));

-- 6. Media details (press_contact_email): validated accounts only (members keep org_media_details_write).
alter policy org_media_details_read on public.organization_media_details
  to authenticated
  using ((select public.is_verified(null::public.persona_enum)));

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

-- 11. Sectors: a visitor reads the sectors of the companies it can see (item 2), no others.
--     Signed-in accounts see every company (org_select_auth), so nothing changes for them.
alter policy oss_public_read on public.organization_service_sectors
  using (exists (select 1 from public.organizations o where o.id = organization_service_sectors.organization_id));
alter policy ois_public_read on public.organization_interest_sectors
  using (exists (select 1 from public.organizations o where o.id = organization_interest_sectors.organization_id));

-- 12. Confirmed recommendations: still public (Q1 = C), but not those of a company a visitor
--     cannot see. Same rows as before for signed-in accounts.
alter policy reference_requests_public_select_confirmed on public.reference_requests
  using (status = 'confirmed'
         and exists (select 1 from public.organizations o where o.id = reference_requests.partner_organization_id));

-- 13. Award wins: the wins of a company M3 has not validated are for validated accounts only (the
--     company a win belongs to is the one a merged copy was merged into). Same columns, grants
--     and owner; the down restores the 20261020130000 body.
create or replace function public.org_award_wins()
returns table (
  organization_id uuid,
  award_key text,
  award_label text,
  competition text,
  award_type text,
  edition_year integer,
  event_slug text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(o.duplicate_of, o.id),
         a.key,
         a.label,
         a.competition,
         a.type,
         extract(year from e.start_date)::integer,
         e.slug
    from sm_award a
    join sm_event e on e.id = a.event_id
    join sm_role_assignment ra on ra.id = a.winner_role_assignment_id
    join sm_registration r on r.id = ra.registration_id
    join organizations o on o.id = coalesce(ra.organization_id, r.organization_id)
    join organizations k on k.id = coalesce(o.duplicate_of, o.id)
   where a.confirmed = true
     and not a.hidden
     and (k.access_status = 'verified' or (select public.is_verified(null::public.persona_enum)))
   order by e.start_date desc, a.sort;
$fn$;

-- ─── C. The held file is in place ──────────────────────────────────────────────────────────────
create temp table _dr_ids on commit drop as
  select (select o.id from public.organizations o where o.organization_type = 'marina' and o.access_status = 'verified' order by o.id limit 1) as m,
         (select o.id from public.organizations o where o.access_status <> 'verified' and o.duplicate_of is null order by o.id limit 1) as p,
         (select p.user_id from public.profiles p where p.access_status = 'verified' order by p.user_id limit 1) as member_user;
do $held$
begin
  perform pg_temp.chk(not exists (select 1 from pg_policies p where p.policyname = 'org_members_select_public')
                      and not has_column_privilege('anon', 'public.organizations', 'owner_user_id', 'select')
                      and not has_function_privilege('anon', 'public.get_public_profile(uuid)', 'execute'),
    'C01 the held file is applied (no anon team read, no anon owner_user_id, no anon get_public_profile)');
end
$held$;

-- The superseded down's own statement, as if it had been run by mistake after the held file: the
-- anon team read is back. The down below must still run (its guard is the column grant).
create policy org_members_select_public on public.organization_members for select to anon using (true);
do $mistake$
begin
  perform pg_temp.chk(exists (select 1 from pg_policies p where p.policyname = 'org_members_select_public')
                      and not has_column_privilege('anon', 'public.organizations', 'primary_domain', 'select'),
    'C02 simulated mistake: org_members_select_public recreated after the held file; anon still without primary_domain');
end
$mistake$;

-- ─── E. The down, verbatim ───────────────────────────────────────────────────────────────────────
-- DOWN for supabase/migrations/held/directory_visitor_basic.sql: signed-out visitors read
-- exactly what they read on 21 Oct 2026 again (column grants, policies with their roles and
-- conditions, function EXECUTE grants with the PUBLIC entries of get_public_profile and
-- org_member_count, the storage policy, the body of org_award_wins). The definitions below were
-- read from production on 21 Oct 2026 (read-only). The dry runs check that every grant and policy
-- is the same set again.
-- In a rollback (runbook §8) run this BEFORE main is published again: main reads all of it
-- signed out.
-- Guarded on the column grant the held file revokes first (anon's SELECT on
-- organizations.primary_domain), not on a policy: the superseded directory_signed_in_only down,
-- run by mistake, recreates org_members_select_public, and this down must still run then. Items 3
-- and 7 drop the policies they create first for the same reason.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if has_column_privilege('anon', 'public.organizations', 'primary_domain', 'select') then
    raise exception 'directory_visitor_basic down: anon still reads organizations.primary_domain, so the held file is not applied; nothing to undo';
  end if;
end
$pre$;

-- 1. organizations: the internal columns again
grant select (primary_domain, max_seats, created_by_user_id, owner_user_id, onboarding_status, rejection_reason,
              auto_approve_domain_joins, social_media_links, marina_subtype)
  on public.organizations to anon;

-- 2. every company again, pending and suspended included
alter policy org_select_public on public.organizations using (true);

-- 3. the team
drop policy if exists org_members_select_public on public.organization_members;
create policy org_members_select_public on public.organization_members for select to anon using (true);

-- 4. marina details of validated marinas, anyone
alter policy marina_details_public_read on public.organization_marina_details
  to public
  using (exists (select 1 from public.organizations o
                  where o.id = organization_marina_details.organization_id and o.access_status = 'verified'));

-- 5. purchase projects, anyone
alter policy ofp_public_read on public.organization_future_plans to public using (true);

-- 6. media details, anyone
alter policy org_media_details_read on public.organization_media_details to public using (true);

-- 7. partner and media cards of verified people, signed out
drop policy if exists partner_profiles_anon_public on public.partner_profiles;
create policy partner_profiles_anon_public on public.partner_profiles for select to anon
  using (exists (select 1 from public.profiles p
                  where p.user_id = partner_profiles.user_id and p.access_status = 'verified'::public.access_status_enum));
drop policy if exists media_partner_profiles_anon_public on public.media_partner_profiles;
create policy media_partner_profiles_anon_public on public.media_partner_profiles for select to anon
  using (exists (select 1 from public.profiles p
                  where p.user_id = media_partner_profiles.user_id and p.access_status = 'verified'::public.access_status_enum));

-- 8. events: the table grant again, without the column grants
revoke select (id, title, description, date_time, location, language, access_level, speakers, replay_url, created_at,
               pdf_url, fees, max_attendance, location_details, event_type, event_website_url, event_partners,
               brochure_url, invitation_only, is_full_day, end_date_time, published, image_url, title_search, slug,
               slug_auto, slug_public)
  on public.events from anon;
grant select on public.events to anon;

-- 9. functions
grant execute on function public.get_public_profile(uuid) to public, anon;
grant execute on function public.org_member_count(uuid) to public, anon;
grant execute on function public.sm_org_marina_submission(uuid) to anon;
grant execute on function public.org_sm26_showcase(uuid) to anon;

-- 10. the evidence images, signed out too
alter policy event_media_marina_evidence_public_read on storage.objects to anon, authenticated;

-- 11. the sectors of every company
alter policy oss_public_read on public.organization_service_sectors using (true);
alter policy ois_public_read on public.organization_interest_sectors using (true);

-- 12. every confirmed recommendation
alter policy reference_requests_public_select_confirmed on public.reference_requests using (status = 'confirmed');

-- 13. org_award_wins as created by 20261020130000 (body md5 4b6a7cbe7a2f83f3d190abd65d5964e2)
create or replace function public.org_award_wins()
returns table (
  organization_id uuid,
  award_key text,
  award_label text,
  competition text,
  award_type text,
  edition_year integer,
  event_slug text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(o.duplicate_of, o.id),
         a.key,
         a.label,
         a.competition,
         a.type,
         extract(year from e.start_date)::integer,
         e.slug
    from sm_award a
    join sm_event e on e.id = a.event_id
    join sm_role_assignment ra on ra.id = a.winner_role_assignment_id
    join sm_registration r on r.id = ra.registration_id
    join organizations o on o.id = coalesce(ra.organization_id, r.organization_id)
   where a.confirmed = true
     and not a.hidden
   order by e.start_date desc, a.sort;
$fn$;

-- ─── F. After the down: the same grants and policies as the snapshot; main's reads answer again ──
do $after$
declare
  v record;
  v_txt text;
  v_out text;
  v_main33 constant text := 'id, name, slug, primary_domain, organization_type, tier, max_seats, created_by_user_id, owner_user_id, logo_url, description, website, country, city, created_at, updated_at, access_status, onboarding_status, rejection_reason, audience_description, headquarters_country, social_media_links, marina_subtype, auto_approve_domain_joins, banner_url, investment_geographies, investment_size_min, investment_size_max, investment_hold_period, investment_thesis, featured_partner, gallery, is_event_media_partner';
begin
  select * into v from _dr_ids;
  perform pg_temp.chk((select a.v from pg_temp.dr_state() a where a.k = 'policies') = (select b.v from _dr_before b where b.k = 'policies'),
    'F01 down: every policy (public and storage) the same as before, roles and conditions included');
  perform pg_temp.chk((select a.v from pg_temp.dr_state() a where a.k = 'organizations columns') = (select b.v from _dr_before b where b.k = 'organizations columns'),
    'F02 down: organizations column grants the same as before');
  perform pg_temp.chk((select a.v from pg_temp.dr_state() a where a.k = 'events columns') = (select b.v from _dr_before b where b.k = 'events columns')
                      and (select a.v from pg_temp.dr_state() a where a.k = 'table grants') = (select b.v from _dr_before b where b.k = 'table grants'),
    'F03 down: events (table and columns) and the other tables'' grants the same as before');
  perform pg_temp.chk((select a.v from pg_temp.dr_state() a where a.k = 'function grants') = (select b.v from _dr_before b where b.k = 'function grants')
                      and exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = 'public.get_public_profile(uuid)'::regprocedure)) x where x.grantee = 0)
                      and exists (select 1 from aclexplode((select p.proacl from pg_proc p where p.oid = 'public.org_member_count(uuid)'::regprocedure)) x where x.grantee = 0),
    'F04 down: every function grant the same set as before, the PUBLIC entries of get_public_profile and org_member_count back');
  perform pg_temp.chk((select a.v from pg_temp.dr_state() a where a.k = 'function bodies') = (select b.v from _dr_before b where b.k = 'function bodies')
                      and (select md5(p.prosrc) from pg_proc p where p.oid = 'public.org_award_wins()'::regprocedure) = '4b6a7cbe7a2f83f3d190abd65d5964e2',
    'F05 down: every public function body the same as before, org_award_wins back to its 20261020130000 body');
  v_out := pg_temp.dr_as('anon', null, format('select count(*)::text from (select %s from public.organizations) x', v_main33))
        || ' ' || pg_temp.dr_as('anon', null, 'select count(*)::text from (select * from public.events) x')
        || ' ' || pg_temp.dr_as('anon', null, format('select count(*)::text from public.get_public_profile(%L)', v.member_user))
        || ' ' || pg_temp.dr_as('anon', null, format('select (public.sm_org_marina_submission(%L) is null)::text', v.m))
        || ' ' || pg_temp.dr_as('anon', null, format('select count(*)::text from public.organizations where id = %L', v.p));
  perform pg_temp.chk(v_out !~ 'err:', 'F06 down: main''s company read, events select *, get_public_profile, SM26 texts and a pending company answer anon again -> ' || left(v_out, 120));
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (directory_visitor_basic down, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$after$;
