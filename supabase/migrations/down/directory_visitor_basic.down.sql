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
