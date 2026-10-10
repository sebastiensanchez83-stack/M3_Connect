-- UNDO of supabase/migrations/held/capabilities_enforce.sql (the switch).
--
-- Puts back, byte for byte, the twelve policies it replaced (as they were on
-- 10 Oct 2026), the partner_requests origin rule, and turns the site's switch
-- registration_flags.capabilities_enforced off; drops the publisher's guard
-- (guard_need_publish_right and its two triggers). Rows written while the switch
-- was on stay; Express interest rows (origin 'interest') go back to origin null,
-- which is what they would have been without the switch. The shadow objects stay
-- (undo them with down/20261010200000_capabilities_shadow.down.sql if wanted).
-- Idempotent: safe to run twice.
--
-- It refuses to run when the policies or the guard the switch created were changed
-- after it (the fingerprint the switch recorded in the comment of
-- partner_requests_insert_capable): restoring 10 Oct 2026 over a later change
-- would lose it silently. Re-read them and update this file first.
--
-- Locks: as the switch (ACCESS EXCLUSIVE on the six tables until it commits); it
-- gives up after 5 s waiting for any one lock: run it again.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 0. Precondition: what the switch created is unchanged ───────────────────
do $pre$
declare
  v_fp text;
  v_saved text;
begin
  -- Only when the switch is there (a second run finds nothing to check).
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'partner_requests'
                and policyname = 'partner_requests_insert_capable') then
    -- Same expression as section 10 of held/capabilities_enforce.sql.
    select md5(string_agg(format('%s.%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, cmd, roles,
                                 coalesce(qual, ''), coalesce(with_check, '')), ';' order by tablename, policyname)
               || coalesce((select md5(p.prosrc) from pg_proc p
                             where p.oid = to_regprocedure('public.guard_need_publish_right()')), '-'))
      into v_fp
      from pg_policies
     where schemaname = 'public'
       and (tablename, policyname) in (
         ('rfps', 'rfps_select_marketplace'), ('rfps', 'rfps_insert_publisher'),
         ('rfps', 'rfps_update_owner'), ('rfps', 'rfps_delete_owner'),
         ('consultations', 'consultations_select_marketplace'), ('consultations', 'consultations_insert_publisher'),
         ('consultations', 'consultations_update_owner'), ('consultations', 'consultations_delete_owner'),
         ('marina_projects', 'marina_projects_insert'),
         ('partner_requests', 'partner_requests_insert_capable'),
         ('webinar_requests', 'webinar_requests_insert_owner_eligible'),
         ('org_capital_intents', 'oci_select_dealflow'));
    select substring(d.description from 'fingerprint ([0-9a-f]{32})')
      into v_saved
      from pg_policy pol
      join pg_description d on d.objoid = pol.oid and d.classoid = 'pg_policy'::regclass
     where pol.polrelid = 'public.partner_requests'::regclass
       and pol.polname = 'partner_requests_insert_capable';
    if v_saved is null or v_fp is distinct from v_saved then
      raise exception 'capabilities switch undo: the policies or the guard the switch created changed since it was applied (fingerprint % instead of %); re-read them and update this file before undoing',
        v_fp, coalesce(v_saved, 'none recorded');
    end if;
  end if;
end
$pre$;

-- ─── 1. partner_requests.origin ──────────────────────────────────────────────
-- Writes wait from here on (reads go on), so no new 'interest' row can arrive
-- between the UPDATE and the stricter rule.
lock table public.partner_requests in share row exclusive mode;

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

-- ─── 4. The publisher's guard ────────────────────────────────────────────────
drop trigger if exists trg_rfps_publish_right on public.rfps;
drop trigger if exists trg_consultations_publish_right on public.consultations;
drop function if exists public.guard_need_publish_right();

-- ─── 5. marina_projects ──────────────────────────────────────────────────────
drop policy if exists marina_projects_insert on public.marina_projects;
create policy marina_projects_insert on public.marina_projects
  as permissive for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ─── 6. partner_requests ─────────────────────────────────────────────────────
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

-- ─── 7. webinar_requests ─────────────────────────────────────────────────────
drop policy if exists webinar_requests_insert_owner_eligible on public.webinar_requests;
create policy webinar_requests_insert_owner_eligible on public.webinar_requests
  as permissive for insert to public
  with check (
    ((user_id = (select auth.uid()))
      and exists (select 1 from public.profiles p
                   where p.user_id = (select auth.uid()) and p.access_status = 'verified'::public.access_status_enum))
    or public.is_moderator()
  );

-- ─── 8. org_capital_intents ──────────────────────────────────────────────────
drop policy if exists oci_select_dealflow on public.org_capital_intents;
drop policy if exists oci_select_verified_investors on public.org_capital_intents;
create policy oci_select_verified_investors on public.org_capital_intents
  as permissive for select to public
  using (exists (select 1 from public.profiles
                  where profiles.user_id = auth.uid()
                    and profiles.persona = 'investor'::public.persona_enum
                    and profiles.access_status = 'verified'::public.access_status_enum));

-- ─── 9. The site's switch, off ───────────────────────────────────────────────
update public.platform_settings
   set value = jsonb_set(value, '{capabilities_enforced}', 'false'::jsonb, true),
       updated_at = now()
 where key = 'registration_flags'
   and jsonb_typeof(value) = 'object';
