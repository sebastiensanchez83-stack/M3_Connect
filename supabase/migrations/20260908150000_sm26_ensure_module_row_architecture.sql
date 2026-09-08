-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- Architecture gets its row too — but only when someone actually submits.
--
-- sm_ensure_module_row deliberately returned 'none' for the two architect roles,
-- because an sm_architecture_entry row IS a competition entry: seeding one
-- because a page was opened, or because staff granted the role, would put a
-- blank submission in front of the jury. The cost of that caution was that an
-- architect whose role was granted by hand had no row at all, and their save —
-- honest since the last fix — would refuse forever.
--
-- So the flag: the caller says whether this moment justifies creating an entry.
-- Only the architect's own save passes true, which is the one moment where a row
-- represents something real, because they have typed it.
--
-- The e-catalogue writer is patched in the same breath. sm_ecat_apply_to_profile
-- copies an approved image into the participant's profile with the same zero-row
-- tolerant update, returns void, and its caller reports the slot as applied —
-- the same false success on the same table, from the other direction.

create or replace function public.sm_ensure_module_row(
  p_role_assignment_id uuid,
  p_allow_architecture boolean default false)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_role text; v_event uuid;
begin
  if not (sm_owns_role_assignment(p_role_assignment_id) or sm_is_staff()) then
    raise exception 'Not authorized';
  end if;

  select ra.role, r.event_id into v_role, v_event
    from sm_role_assignment ra
    join sm_registration r on r.id = ra.registration_id
   where ra.id = p_role_assignment_id;
  if v_role is null then raise exception 'role assignment not found'; end if;

  if v_role = 'startup' then
    insert into sm_startup_profile (role_assignment_id, event_id)
      values (p_role_assignment_id, v_event)
      on conflict (role_assignment_id) do nothing;
    return 'sm_startup_profile';
  elsif v_role = 'marina' then
    insert into sm_marina_extra (role_assignment_id, event_id)
      values (p_role_assignment_id, v_event)
      on conflict (role_assignment_id) do nothing;
    return 'sm_marina_extra';
  elsif v_role in ('architect_pro', 'architect_student') and p_allow_architecture then
    insert into sm_architecture_entry (role_assignment_id, event_id)
      values (p_role_assignment_id, v_event)
      on conflict (role_assignment_id) do nothing;
    return 'sm_architecture_entry';
  end if;

  return 'none';
end $function$;

revoke all on function public.sm_ensure_module_row(uuid, boolean) from anon;
grant execute on function public.sm_ensure_module_row(uuid, boolean) to authenticated;

-- The single-argument signature the already-deployed client calls. Dropped only
-- after the new one exists, so no request falls between the two; the new one is
-- callable with the same single named argument thanks to the default.
drop function if exists public.sm_ensure_module_row(uuid);

-- == The e-catalogue's copy of the same defect ==
--
-- Unchanged except for the insert marked below: a startup whose typed row is
-- missing would otherwise have the module_data half of an approved image land
-- and the profile half vanish, while the caller reported the slot as applied.

create or replace function public.sm_ecat_apply_to_profile(p_page_id uuid, p_path text, p_field_key text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_reg uuid; v_ra uuid; v_role text; v_md jsonb; v_is_array boolean; v_alias text;
begin
  if p_path is null or length(trim(p_path))=0 or p_field_key is null or length(trim(p_field_key))=0 then
    raise exception 'missing arguments';
  end if;
  -- The image must be one the caller uploaded (their own uid folder).
  if split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'path not owned by caller';
  end if;
  select p.registration_id, p.role_assignment_id into v_reg, v_ra from sm_ecat_page p where p.id = p_page_id;
  if v_ra is null then raise exception 'page not found'; end if;
  if not public.sm_can_access_registration(v_reg) then raise exception 'not authorized'; end if;
  select ra.role, coalesce(ra.module_data,'{}'::jsonb) into v_role, v_md from sm_role_assignment ra where ra.id = v_ra;

  v_is_array := p_field_key in ('product_images','project_renders','renders','panels','slides');
  if v_is_array then
    v_md := jsonb_set(v_md, array[p_field_key],
      (case when jsonb_typeof(v_md->p_field_key)='array' then v_md->p_field_key else '[]'::jsonb end) || to_jsonb(p_path), true);
  else
    -- Set the canonical key and drop the sibling alias (logo <-> logo_url), so no
    -- stale duplicate of the same logical asset lingers under the other name.
    v_alias := case when right(p_field_key,4)='_url' then left(p_field_key, length(p_field_key)-4) else p_field_key||'_url' end;
    v_md := jsonb_set(v_md, array[p_field_key], jsonb_build_array(p_path), true);
    if v_alias <> p_field_key then v_md := v_md - v_alias; end if;
  end if;
  -- Triggers on sm_role_assignment sync module_data -> sm_architecture_entry.
  update sm_role_assignment set module_data = v_md where id = v_ra;

  -- Startups also keep a typed profile row that the dossier reads directly.
  if v_role = 'startup' then
    -- Every update below matches on role_assignment_id and is zero-row tolerant.
    -- Make the row exist rather than write into nothing and report success.
    insert into sm_startup_profile (role_assignment_id, event_id)
      select v_ra, r.event_id from sm_registration r where r.id = v_reg
      on conflict (role_assignment_id) do nothing;
    if p_field_key in ('logo','logo_url') then
      update sm_startup_profile set logo_url = p_path where role_assignment_id = v_ra;
    elsif p_field_key in ('deck','deck_url') then
      update sm_startup_profile set deck_url = p_path where role_assignment_id = v_ra;
    elsif p_field_key in ('pitch_media','pitch_media_url') then
      update sm_startup_profile set pitch_media_url = p_path where role_assignment_id = v_ra;
    elsif p_field_key = 'product_images' then
      update sm_startup_profile set product_images = array_append(coalesce(product_images, '{}'::text[]), p_path) where role_assignment_id = v_ra;
    end if;
  end if;
end $function$;
