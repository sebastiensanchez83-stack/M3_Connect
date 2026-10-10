-- UNDO of supabase/migrations/20261010200000_capabilities_shadow.sql
--
-- Refuses to run while the switch (supabase/migrations/held/capabilities_enforce.sql)
-- is applied: its policies call has_capability. Undo the switch first
-- (supabase/migrations/down/capabilities_enforce.down.sql).
--
-- The platform_settings row 'registration_flags' stays: it is shared with the
-- registration work (20261009200000_registration_prereqs). Only
-- capabilities_enforced is put back to false, so the site gates nothing.

do $pre$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public'
                and (coalesce(qual, '') like '%has_capability%' or coalesce(with_check, '') like '%has_capability%')) then
    raise exception 'capabilities shadow undo: policies still call has_capability; run down/capabilities_enforce.down.sql first';
  end if;
end
$pre$;

update public.platform_settings
   set value = jsonb_set(value, '{capabilities_enforced}', 'false'::jsonb, true)
 where key = 'registration_flags'
   and jsonb_typeof(value) = 'object';

drop function if exists public.capability_shadow_report();
drop function if exists public.my_capabilities();
drop function if exists public.has_capability(text, uuid);
drop function if exists public.capability_set(uuid, uuid);
drop table if exists public.org_type_capability;
