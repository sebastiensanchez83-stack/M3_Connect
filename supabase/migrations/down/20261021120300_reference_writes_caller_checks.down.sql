-- DOWN for supabase/migrations/20261021120300_reference_writes_caller_checks.sql
-- Gives anon and authenticated their write privileges on reference_requests and
-- reference_recipients back, recreates the two INSERT policies, restores create_reference_request
-- without its caller check (body identical to before, md5 5c9884a8330cdab64303a2708932e903) and
-- its EXECUTE for PUBLIC and anon: any signed-in account can fake a confirmed recommendation
-- again. Harmless for main and refonte (they only use the RPC and the client_organization_id
-- update). Undo the send-reference-email caller check separately if wanted (it does not depend on
-- this file).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if has_table_privilege('authenticated', 'public.reference_requests', 'insert')
     or exists (select 1 from pg_policies p
                 where p.schemaname = 'public'
                   and p.policyname in ('reference_requests_insert', 'reference_recipients_insert')) then
    raise exception 'reference writes down: the write privileges or policies are already there (nothing to undo)';
  end if;
end
$pre$;

revoke update (client_organization_id) on table public.reference_requests from authenticated;
grant insert, update, delete, truncate, references, trigger on table public.reference_requests to anon, authenticated;
grant insert, update, delete, truncate, references, trigger on table public.reference_recipients to anon, authenticated;

create policy reference_requests_insert on public.reference_requests
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy reference_recipients_insert on public.reference_recipients
  for insert to authenticated
  with check (reference_request_id in (select reference_requests.id
                                         from public.reference_requests
                                        where reference_requests.created_by = (select auth.uid())));

create or replace function public.create_reference_request(p_partner_org_id uuid, p_created_by uuid,
  p_client_legal_name text, p_client_country text, p_client_website text, p_client_primary_domain text,
  p_project_name text, p_project_location text, p_project_start_date date, p_project_end_date date,
  p_project_delivery_date date, p_contract_reference text, p_solution_product text, p_scope_description text,
  p_results_summary text, p_key_kpis text, p_recommendation_statement text)
 returns public.reference_requests
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  new_ref reference_requests;
BEGIN
  INSERT INTO reference_requests (
    reference_id, verification_code,
    partner_organization_id, created_by,
    client_legal_name, client_country, client_website, client_primary_domain,
    project_name, project_location, project_start_date, project_end_date,
    project_delivery_date, contract_reference, solution_product, scope_description,
    results_summary, key_kpis, recommendation_statement
  ) VALUES (
    generate_reference_id(), generate_verification_code(),
    p_partner_org_id, p_created_by,
    p_client_legal_name, p_client_country, p_client_website, p_client_primary_domain,
    p_project_name, p_project_location, p_project_start_date, p_project_end_date,
    p_project_delivery_date, p_contract_reference, p_solution_product, p_scope_description,
    p_results_summary, p_key_kpis, p_recommendation_statement
  ) RETURNING * INTO new_ref;
  
  -- Log creation event
  INSERT INTO reference_events (reference_request_id, event_type, actor_type, actor_id)
  VALUES (new_ref.id, 'created', 'partner', p_created_by::text);
  
  RETURN new_ref;
END;
$function$;

grant execute on function public.create_reference_request(uuid, uuid, text, text, text, text, text, text,
  date, date, date, text, text, text, text, text, text) to public, anon;

do $post$
declare
  v_fn regprocedure := to_regprocedure('public.create_reference_request(uuid, uuid, text, text, text, text, text, text, '
                                       || 'date, date, date, text, text, text, text, text, text)');
  v_src text;
begin
  select p.prosrc into v_src from pg_proc p where p.oid = v_fn;
  -- The body above keeps two lines of two spaces, as before. If an editor stripped them, the body
  -- is the same once trailing spaces are removed (md5 d598685bf18afc9f38d58d9794b9dfa1).
  if (md5(v_src) is distinct from '5c9884a8330cdab64303a2708932e903'
      and md5(regexp_replace(v_src, ' +' || chr(10), chr(10), 'g')) is distinct from 'd598685bf18afc9f38d58d9794b9dfa1')
     or not has_function_privilege('anon', v_fn, 'execute')
     or not has_table_privilege('authenticated', 'public.reference_requests', 'insert')
     or not has_table_privilege('authenticated', 'public.reference_recipients', 'insert') then
    raise exception 'reference writes down: the previous state is not fully back';
  end if;
end
$post$;
