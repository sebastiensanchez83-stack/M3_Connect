-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- The Yacht Club's console shows who is coming, not who applied.
--
-- Every view already dropped cancelled and declined registrations, but not the
-- ones still sitting at `submitted` — an application M3 has not confirmed. One
-- of those was being read as a real exhibitor: it appeared in the company list
-- and the dossiers, had two e-catalogue pages queued for production, and its
-- `coming_on_site` flag put it in the logistics dossier with two covers at the
-- brunch. The venue was preparing for a stand nobody had confirmed.
--
-- So the rule across the partner console is `confirmed`, with one deliberate
-- exception: media. Press accreditation is the Yacht Club's own decision, taken
-- on people whose registration is by definition not settled yet — filtering
-- those out would empty the very list they are meant to act on. Accreditation
-- keeps its own status on the role assignment.
--
-- Nothing here changes a registration. An application that is confirmed later
-- reappears everywhere on its own.

create or replace function public.sm_partner_entries(p_event_id uuid)
returns table(role_assignment_id uuid, reg_id uuid, role text, name text, company text,
              job_title text, country text, thumb text, payment_status text,
              jury_scope text, catalogue_listed boolean)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not (sm_is_staff() or sm_is_event_partner(p_event_id)) then raise exception 'Not authorized'; end if;
  return query
  select ra.id, r.id, ra.role,
    nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')),''),
    nullif(trim(r.company_name),''),
    nullif(trim(r.job_title),''),
    r.country,
    coalesce(sp.logo_url, sm_md_asset(ra.module_data,'logo_url'), sm_md_asset(ra.module_data,'logo'),
             sm_md_asset(ra.module_data,'photo_url'), sm_md_asset(ra.module_data,'photo'),
             sm_md_asset(ra.module_data,'hero_image')),
    case when ra.role in ('startup','marina','architect_pro','architect_student') then
      case
        when pay.status in ('paid','waived') then 'paid'
        when pay.status is not null then 'awaiting'
        when ra.role in ('startup','marina') then 'awaiting'
        else 'free'
      end
    else null end,
    case when ra.role = 'jury' then ra.module_data->>'jury_scope' else null end,
    (cl.role_assignment_id is not null)
  from sm_role_assignment ra
  join sm_registration r on r.id = ra.registration_id
  left join sm_startup_profile sp on sp.role_assignment_id = ra.id
  left join sm_payment pay on pay.registration_id = r.id
  left join sm_catalogue_listing cl on cl.role_assignment_id = ra.id
  where ra.event_id = p_event_id
    and ra.role in ('startup','jury','sponsor','speaker','marina','architect_pro','architect_student','media')
    and ra.status <> 'declined'
    -- Media is the exception: an accreditation request is judged here, and its
    -- registration is not confirmed at the moment the Yacht Club has to judge it.
    and (ra.role = 'media' or r.status = 'confirmed')
  order by ra.role, r.company_name nulls last, r.last_name;
end $function$;

create or replace function public.sm_partner_dossiers(p_event_id uuid)
returns table(role_assignment_id uuid, reg_id uuid, role text, company text, name text,
              job_title text, website text, country text, email text,
              module_data jsonb, startup jsonb, requirements jsonb)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not (sm_is_staff() or sm_is_event_partner(p_event_id)) then raise exception 'Not authorized'; end if;
  return query
  select ra.id, r.id, ra.role,
    nullif(trim(r.company_name),''),
    nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')),''),
    nullif(trim(r.job_title),''),
    r.website, r.country,
    case when ra.role in ('startup','marina','architect_pro','architect_student') then r.email else null end,
    coalesce(ra.module_data,'{}'::jsonb)
      || case
           when ra.role in ('architect_pro','architect_student') and ae.role_assignment_id is not null
             then jsonb_strip_nulls(jsonb_build_object(
                    'company_description', ae.company_description,
                    'sustainability_statement', ae.sustainability_statement,
                    'domain', ae.domain,
                    'references_text', ae.references_text,
                    'portfolio_link', ae.portfolio_link,
                    'social_links', ae.social_links))
           else '{}'::jsonb
         end,
    case when ra.role = 'startup' then to_jsonb(sp.*) else null end,
    coalesce((
      select jsonb_agg(jsonb_build_object('field_key', rq.field_key, 'label', rq.label,
                       'required', rq.required, 'is_asset', rq.is_asset) order by rq.display_order)
      from sm_role_requirement rq where rq.event_id = ra.event_id and rq.role = ra.role
    ), '[]'::jsonb)
  from sm_role_assignment ra
  join sm_registration r on r.id = ra.registration_id
  left join sm_startup_profile sp on sp.role_assignment_id = ra.id
  left join sm_architecture_entry ae on ae.role_assignment_id = ra.id
  where ra.event_id = p_event_id
    and ra.role in ('startup','jury','sponsor','speaker','marina','architect_pro','architect_student')
    and ra.status <> 'declined' and r.status = 'confirmed'
  order by ra.role, r.company_name nulls last, r.last_name;
end $function$;

create or replace function public.sm_partner_ecat(p_event_id uuid)
returns table(id uuid, registration_id uuid, kind text, status text, title text,
              designed_file_path text, changes_note text, change_attachments text[])
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not (sm_is_staff() or sm_is_event_partner(p_event_id)) then raise exception 'Not authorized'; end if;
  return query
  select p.id, p.registration_id, p.kind, p.status,
    coalesce(nullif(trim(r.company_name),''), nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')),''), 'Entry'),
    p.designed_file_path,
    (select c.body from sm_ecat_comment c where c.ecat_page_id = p.id and c.author_role = 'participant' order by c.created_at desc limit 1),
    (select c.attachment_paths from sm_ecat_comment c where c.ecat_page_id = p.id and c.author_role = 'participant' order by c.created_at desc limit 1)
  from sm_ecat_page p
  join sm_registration r on r.id = p.registration_id
  where p.event_id = p_event_id and r.status = 'confirmed'
  order by r.company_name nulls last;
end $function$;

-- The logistics dossier is the sheet the venue works from: an unconfirmed stand
-- here becomes a table, a socket and a place at the brunch.
create or replace function public.sm_logistics_dossier(p_event_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  result jsonb;
begin
  if not (sm_is_staff() or sm_is_event_partner(p_event_id)) then
    raise exception 'Not authorized';
  end if;

  select jsonb_build_object(

    'decisions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'company', coalesce(nullif(trim(r.company_name), ''), r.last_name, 'Exhibitor'),
               'kind', i.kind, 'label', i.label,
               'width_cm', i.width_cm, 'height_cm', i.height_cm, 'depth_cm', i.depth_cm,
               'weight_kg', i.weight_kg, 'photo', (i.photo_path is not null))
               order by coalesce(nullif(trim(r.company_name), ''), r.last_name), i.created_at), '[]'::jsonb)
        from sm_logistics_item i
        join sm_registration r on r.id = i.registration_id
       where i.event_id = p_event_id
         and i.needs_approval
         and i.approval_status = 'pending'
         and r.status = 'confirmed'
         and not exists (select 1 from sm_logistics l
                          where l.registration_id = i.registration_id
                            and l.coming_on_site is false)),

    'technical', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'need', x.need,
               'company', coalesce(nullif(trim(r.company_name), ''), r.last_name, 'Exhibitor'),
               'detail', x.detail)
               order by x.rank, coalesce(nullif(trim(r.company_name), ''), r.last_name)), '[]'::jsonb)
        from sm_logistics l
        join sm_registration r on r.id = l.registration_id
        cross join lateral (values
            (1, 'power', l.power_details),
            (2, 'internet', null),
            (3, 'water', null),
            (4, 'vehicle', l.vehicle_details)
          ) as x(rank, need, detail)
       where l.event_id = p_event_id
         and l.coming_on_site
         and r.status = 'confirmed'
         and ((x.rank = 1 and l.power_needed)
           or (x.rank = 2 and l.internet_needed)
           or (x.rank = 3 and l.water_needed)
           or (x.rank = 4 and l.vehicle_access))),

    'exhibitors', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'company', coalesce(nullif(trim(r.company_name), ''), r.last_name, 'Exhibitor'),
               'people', coalesce(r.num_attendees, 0),
               'items', (select count(*) from sm_logistics_item i where i.registration_id = l.registration_id),
               'brunch', coalesce(l.brunch_covers, 0),
               'notes', nullif(trim(l.notes), ''))
               order by coalesce(nullif(trim(r.company_name), ''), r.last_name)), '[]'::jsonb)
        from sm_logistics l
        join sm_registration r on r.id = l.registration_id
       where l.event_id = p_event_id
         and l.coming_on_site
         and r.status = 'confirmed'),

    'totals', jsonb_build_object(
      'exhibitors', (select count(*) from sm_logistics l
                       join sm_registration r on r.id = l.registration_id
                      where l.event_id = p_event_id and l.coming_on_site
                        and r.status = 'confirmed'),
      'people',     (select coalesce(sum(r.num_attendees), 0) from sm_logistics l
                       join sm_registration r on r.id = l.registration_id
                      where l.event_id = p_event_id and l.coming_on_site
                        and r.status = 'confirmed'),
      'power',      (select count(*) from sm_logistics l
                       join sm_registration r on r.id = l.registration_id
                      where l.event_id = p_event_id and l.coming_on_site and l.power_needed
                        and r.status = 'confirmed'),
      'brunch',     (select coalesce(sum(l.brunch_covers), 0) from sm_logistics l
                       join sm_registration r on r.id = l.registration_id
                      where l.event_id = p_event_id and l.coming_on_site
                        and r.status = 'confirmed'),
      -- Same rule as `decisions`, or the headline count contradicts the list
      -- printed underneath it.
      'pending',    (select count(*) from sm_logistics_item i
                       join sm_registration r on r.id = i.registration_id
                      where i.event_id = p_event_id and i.needs_approval and i.approval_status = 'pending'
                        and r.status = 'confirmed'
                        and not exists (select 1 from sm_logistics l
                                         where l.registration_id = i.registration_id
                                           and l.coming_on_site is false)))
  ) into result;

  return result;
end $function$;
