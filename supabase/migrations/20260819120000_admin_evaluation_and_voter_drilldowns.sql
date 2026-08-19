-- Read-only, staff-gated drill-downs for the merged Evaluation & Awards admin console.
-- (1) sm_admin_evaluations   — who scored which entry + their review summary (matrix source)
-- (2) sm_admin_evaluation_detail — the full filled scorecard for one review (every grade + comment)
-- (3) sm_admin_vote_voters   — who voted, per competition/entry (voter identity already on sm_public_vote)
-- All SECURITY DEFINER + sm_is_staff() guard; nothing here changes how scoring / voting / rankings work.
-- Already applied to the remote project via the Supabase MCP; kept here for traceability.

create or replace function public.sm_admin_evaluations(p_event_id uuid, p_competition text)
returns table(
  entry_id uuid, entry_title text, entry_subtitle text,
  juror_user_id uuid, juror_name text, juror_type text,
  review_id uuid, status text, total_score numeric, confidence integer,
  coi_flag boolean, submitted_at timestamptz
)
language plpgsql stable security definer set search_path to 'public','pg_temp'
as $$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  select ja.entry_role_assignment_id,
    case when p_competition='innovation'
      then coalesce(nullif(trim(r.company_name),''), nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')),''), 'Entry')
      else 'Entry '||coalesce(ae.anon_code, left(ra.id::text,8)) end,
    case when p_competition='innovation' then coalesce(sp.stage,'') else coalesce(ae.category,'') end,
    ja.juror_user_id,
    coalesce(nullif(trim(coalesce(pr.first_name,'')||' '||coalesce(pr.last_name,'')),''), pr.email, arv.name, 'Juror'),
    (select rj.module_data->>'jury_type' from sm_role_assignment rj
       join sm_registration r2 on r2.id=rj.registration_id
       where rj.event_id=p_event_id and rj.role='jury' and r2.user_id=ja.juror_user_id limit 1),
    rv.id, coalesce(rv.status,'not_started'), rv.total_score, rv.confidence, rv.coi_flag, rv.submitted_at
  from sm_jury_assignment ja
  join sm_role_assignment ra on ra.id = ja.entry_role_assignment_id
  join sm_registration r on r.id = ra.registration_id
  left join sm_startup_profile sp on sp.role_assignment_id = ra.id
  left join sm_architecture_entry ae on ae.role_assignment_id = ra.id
  left join profiles pr on pr.user_id = ja.juror_user_id
  left join sm_architecture_reviewer arv on arv.juror_user_id = ja.juror_user_id and arv.event_id = p_event_id
  left join sm_review rv on rv.entry_role_assignment_id = ja.entry_role_assignment_id and rv.juror_user_id = ja.juror_user_id
  where ja.event_id = p_event_id and ja.competition = p_competition
    and r.status not in ('declined','cancelled') and ra.status <> 'declined'
  order by 2, 5;
end $$;

create or replace function public.sm_admin_evaluation_detail(p_review_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_temp'
as $$
declare v jsonb;
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  select jsonb_build_object(
    'review_id', rv.id,
    'juror_name', coalesce(nullif(trim(coalesce(pr.first_name,'')||' '||coalesce(pr.last_name,'')),''), pr.email, arv.name, 'Juror'),
    'competition', rv.competition,
    'entry_title', case when rv.competition='innovation'
        then coalesce(nullif(trim(r.company_name),''), nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')),''), 'Entry')
        else 'Entry '||coalesce(ae.anon_code, left(ra.id::text,8)) end,
    'template_name', t.name,
    'scale_max', t.scale_max,
    'status', rv.status,
    'total_score', rv.total_score,
    'confidence', rv.confidence,
    'coi_flag', rv.coi_flag,
    'submitted_at', rv.submitted_at,
    'criteria', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', c.label, 'description', c.description, 'weight', c.weight, 'critical', c.critical,
        'score', cs.score, 'comment', cs.comment) order by c.display_order)
      from sm_criterion c
      left join sm_criterion_score cs on cs.criterion_id = c.id and cs.review_id = rv.id
      where c.template_id = rv.template_id), '[]'::jsonb)
  ) into v
  from sm_review rv
  join sm_role_assignment ra on ra.id = rv.entry_role_assignment_id
  join sm_registration r on r.id = ra.registration_id
  left join sm_architecture_entry ae on ae.role_assignment_id = ra.id
  left join sm_scorecard_template t on t.id = rv.template_id
  left join profiles pr on pr.user_id = rv.juror_user_id
  left join sm_architecture_reviewer arv on arv.juror_user_id = rv.juror_user_id and arv.event_id = rv.event_id
  where rv.id = p_review_id;
  return v;
end $$;

create or replace function public.sm_admin_vote_voters(p_event_id uuid, p_competition text, p_entry_id uuid default null)
returns table(
  voter_user_id uuid, voter_name text, email text, company text, persona text,
  entry_id uuid, entry_title text, voted_at timestamptz
)
language plpgsql stable security definer set search_path to 'public','pg_temp'
as $$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  select v.voter_user_id,
    coalesce(nullif(trim(coalesce(pr.first_name,'')||' '||coalesce(pr.last_name,'')),''), pr.email, 'Voter'),
    pr.email, reg.company, pr.persona,
    v.entry_role_assignment_id,
    coalesce(nullif(trim(r.company_name),''), nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')),''), 'Entry'),
    v.created_at
  from sm_public_vote v
  left join profiles pr on pr.user_id = v.voter_user_id
  join sm_role_assignment ra on ra.id = v.entry_role_assignment_id
  join sm_registration r on r.id = ra.registration_id
  left join lateral (
    select nullif(trim(r2.company_name),'') as company
    from sm_registration r2 where r2.user_id = v.voter_user_id and r2.event_id = p_event_id
    order by r2.created_at limit 1
  ) reg on true
  where v.event_id = p_event_id and v.competition = p_competition
    and (p_entry_id is null or v.entry_role_assignment_id = p_entry_id)
  order by v.created_at desc;
end $$;

grant execute on function public.sm_admin_evaluations(uuid, text) to authenticated;
grant execute on function public.sm_admin_evaluation_detail(uuid) to authenticated;
grant execute on function public.sm_admin_vote_voters(uuid, text, uuid) to authenticated;
