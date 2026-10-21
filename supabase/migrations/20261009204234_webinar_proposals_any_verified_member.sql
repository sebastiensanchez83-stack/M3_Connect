-- RECOVERED 21 Oct 2026: this migration was applied to production on 9 Oct 2026 but its repo file
-- was missing. Text below is copied verbatim from supabase_migrations.schema_migrations.statements
-- (version 20261009204234, name webinar_proposals_any_verified_member). Already applied: do not re-run.

-- Victor, 9 Oct 2026: "toute personne validée par M3 pour être sur la plateforme peut proposer
-- des webinaires". The platform is free (6 Oct): the old subscription quota on webinar proposals
-- (0 for the 'member' tier, i.e. 276 of 278 companies) is lifted, and the insert policy no longer
-- filters on persona. Dry run 9 Oct 2026 (rolled back): verified individual allowed; pending,
-- someone else's name and anon refused (42501).
-- Undo: restore tier_entitlement_defaults (member false/0, innovation_partner true/5), re-run
-- sync_org_entitlements per org, and recreate the previous persona-based policy.
update public.tier_entitlement_defaults set enabled = true, quota = null where feature_key = 'webinar_requests';
update public.entitlements set enabled = true, quota = null, updated_at = now() where feature_key = 'webinar_requests';

drop policy if exists webinar_requests_insert_owner_eligible on public.webinar_requests;
create policy webinar_requests_insert_owner_eligible on public.webinar_requests
  for insert to public
  with check (
    ((user_id = (select auth.uid()))
      and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.access_status = 'verified'::access_status_enum))
    or public.is_moderator()
  );
