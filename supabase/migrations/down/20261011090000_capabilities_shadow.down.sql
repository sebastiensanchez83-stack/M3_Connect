-- UNDO of supabase/migrations/20261011090000_capabilities_shadow.sql
-- (first written as 20261010200000; renamed before anything was applied)
--
-- Drops the person-level grants too (capability_person_grant): a row M3 added or
-- deleted by hand since is lost; applying the migration again re-seeds the
-- SM26-confirmed investors from the sm_* tables.
--
-- Refuses to run while the switch (supabase/migrations/held/capabilities_enforce.sql)
-- is applied: its policies and its trigger guard call has_capability. Undo the
-- switch first (supabase/migrations/down/capabilities_enforce.down.sql).
--
-- The platform_settings row 'registration_flags':
--  * removed when it is exactly the all-off row this migration creates and the
--    registration work (20261009200000_registration_prereqs, which adds the
--    same row next to 'review_sla_text') is not applied: then this migration
--    created it, and the undo is complete;
--  * otherwise kept (it is shared with the registration work): only
--    capabilities_enforced is put back to false, so the site gates nothing.

do $pre$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public'
                and (coalesce(qual, '') like '%has_capability%' or coalesce(with_check, '') like '%has_capability%'))
     or to_regprocedure('public.guard_need_publish_right()') is not null then
    raise exception 'capabilities shadow undo: the switch is still applied (policies or the publisher guard call has_capability); run down/capabilities_enforce.down.sql first';
  end if;
end
$pre$;

delete from public.platform_settings
 where key = 'registration_flags'
   and value = jsonb_build_object(
         'webinar_v2', false, 'onsite_v2', false, 'front_door', false, 'account_signup_v2', false,
         'password_only_login', false, 'wys_form_v2', false, 'wys_status_edit', false,
         'review_queue', false, 'provisioning', false, 'capabilities_enforced', false, 'turnstile', false)
   and not exists (select 1 from public.platform_settings s where s.key = 'review_sla_text');

update public.platform_settings
   set value = jsonb_set(value, '{capabilities_enforced}', 'false'::jsonb, true)
 where key = 'registration_flags'
   and jsonb_typeof(value) = 'object';

drop function if exists public.capability_shadow_report();
drop function if exists public.my_capabilities();
drop function if exists public.has_capability(text, uuid);
drop function if exists public.capability_set(uuid, uuid);
drop table if exists public.capability_person_grant;
drop table if exists public.org_type_capability;
