-- DOWN for supabase/migrations/held/directory_visitor_basic.sql: signed-out visitors read
-- exactly what they read on 21 Oct 2026 again (column grants, policies with their roles and
-- conditions, function EXECUTE grants with the PUBLIC entries of get_public_profile and
-- org_member_count, the storage policy). The definitions below were read from production on
-- 21 Oct 2026 (read-only). The dry runs check that every grant and policy is the same set again.
-- In a rollback (runbook §8) run this BEFORE main is published again: main reads all of it
-- signed out.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
              and p.policyname = 'org_members_select_public') then
    raise exception 'directory_visitor_basic down: org_members_select_public exists, so the held file is not applied; nothing to undo';
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
create policy partner_profiles_anon_public on public.partner_profiles for select to anon
  using (exists (select 1 from public.profiles p
                  where p.user_id = partner_profiles.user_id and p.access_status = 'verified'::public.access_status_enum));
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
