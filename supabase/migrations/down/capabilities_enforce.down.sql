-- UNDO of supabase/migrations/held/capabilities_enforce.sql (the switch).
--
-- Puts back, byte for byte, the twelve policies it replaced (as they were on
-- 10 Oct 2026), the partner_requests origin rule, and turns the site's switch
-- registration_flags.capabilities_enforced off. Rows written while the switch was
-- on stay; Express interest rows (origin 'interest') go back to origin null, which
-- is what they would have been without the switch. The shadow objects stay (undo
-- them with down/20261010200000_capabilities_shadow.down.sql if wanted).
-- Idempotent: safe to run twice.

-- ─── 1. partner_requests.origin ──────────────────────────────────────────────
update public.partner_requests set origin = null where origin = 'interest';

alter table public.partner_requests drop constraint if exists partner_requests_origin_check;
alter table public.partner_requests
  add constraint partner_requests_origin_check
  check (origin is null or origin = 'message');

-- ─── 2. rfps ─────────────────────────────────────────────────────────────────
drop policy if exists rfps_select_marketplace on public.rfps;
drop policy if exists rfps_insert_publisher on public.rfps;
drop policy if exists rfps_update_owner on public.rfps;
drop policy if exists rfps_delete_owner on public.rfps;
drop policy if exists rfps_select_developer on public.rfps;
drop policy if exists rfps_write_owner on public.rfps;
drop policy if exists rfps_write_owner_developer on public.rfps;

create policy rfps_select_developer on public.rfps
  as permissive for select to authenticated
  using ((select public.is_verified('developer'::public.persona_enum)));
create policy rfps_select_marketplace on public.rfps
  as permissive for select to authenticated
  using (public.is_moderator() or marina_user_id = (select auth.uid()) or public.has_marketplace_access());
create policy rfps_write_owner on public.rfps
  as permissive for all to authenticated
  using (marina_user_id = (select auth.uid()) and public.is_verified('marina'::public.persona_enum))
  with check (marina_user_id = (select auth.uid()) and public.is_verified('marina'::public.persona_enum));
create policy rfps_write_owner_developer on public.rfps
  as permissive for all to authenticated
  using (marina_user_id = (select auth.uid()) and public.is_verified('developer'::public.persona_enum))
  with check (marina_user_id = (select auth.uid()) and public.is_verified('developer'::public.persona_enum));

-- ─── 3. consultations ────────────────────────────────────────────────────────
drop policy if exists consultations_select_marketplace on public.consultations;
drop policy if exists consultations_insert_publisher on public.consultations;
drop policy if exists consultations_update_owner on public.consultations;
drop policy if exists consultations_delete_owner on public.consultations;
drop policy if exists consultations_select_developer on public.consultations;
drop policy if exists consultations_write_owner on public.consultations;
drop policy if exists consultations_write_owner_developer on public.consultations;

create policy consultations_select_developer on public.consultations
  as permissive for select to authenticated
  using ((select public.is_verified('developer'::public.persona_enum)));
create policy consultations_select_marketplace on public.consultations
  as permissive for select to authenticated
  using (public.is_moderator() or marina_user_id = (select auth.uid()) or public.has_marketplace_access());
create policy consultations_write_owner on public.consultations
  as permissive for all to authenticated
  using (marina_user_id = (select auth.uid()) and public.is_verified('marina'::public.persona_enum))
  with check (marina_user_id = (select auth.uid()) and public.is_verified('marina'::public.persona_enum));
create policy consultations_write_owner_developer on public.consultations
  as permissive for all to authenticated
  using (marina_user_id = (select auth.uid()) and public.is_verified('developer'::public.persona_enum))
  with check (marina_user_id = (select auth.uid()) and public.is_verified('developer'::public.persona_enum));

-- ─── 4. marina_projects ──────────────────────────────────────────────────────
drop policy if exists marina_projects_insert on public.marina_projects;
create policy marina_projects_insert on public.marina_projects
  as permissive for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ─── 5. partner_requests ─────────────────────────────────────────────────────
drop policy if exists partner_requests_insert_capable on public.partner_requests;
drop policy if exists partner_requests_insert_verified on public.partner_requests;
create policy partner_requests_insert_verified on public.partner_requests
  as permissive for insert to authenticated
  with check (
    ((partner_user_id = (select auth.uid())) or (marina_user_id = (select auth.uid())))
    and exists (select 1 from public.profiles
                 where profiles.user_id = (select auth.uid())
                   and profiles.access_status = 'verified'::public.access_status_enum)
  );

-- ─── 6. webinar_requests ─────────────────────────────────────────────────────
drop policy if exists webinar_requests_insert_owner_eligible on public.webinar_requests;
create policy webinar_requests_insert_owner_eligible on public.webinar_requests
  as permissive for insert to public
  with check (
    ((user_id = (select auth.uid()))
      and exists (select 1 from public.profiles p
                   where p.user_id = (select auth.uid()) and p.access_status = 'verified'::public.access_status_enum))
    or public.is_moderator()
  );

-- ─── 7. org_capital_intents ──────────────────────────────────────────────────
drop policy if exists oci_select_dealflow on public.org_capital_intents;
drop policy if exists oci_select_verified_investors on public.org_capital_intents;
create policy oci_select_verified_investors on public.org_capital_intents
  as permissive for select to public
  using (exists (select 1 from public.profiles
                  where profiles.user_id = auth.uid()
                    and profiles.persona = 'investor'::public.persona_enum
                    and profiles.access_status = 'verified'::public.access_status_enum));

-- ─── 8. The site's switch, off ───────────────────────────────────────────────
update public.platform_settings
   set value = jsonb_set(value, '{capabilities_enforced}', 'false'::jsonb, true),
       updated_at = now()
 where key = 'registration_flags'
   and jsonb_typeof(value) = 'object';
