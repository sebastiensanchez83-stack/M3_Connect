-- Fake recommendations, 21 Oct 2026. Found by the review of the go-live runbook's three holes
-- (P2.4, Q8 = a), outside them: any signed-in account can publish a "confirmed" recommendation
-- on any company's page, and a visitor can get one mailed out for any company.
-- Down: supabase/migrations/down/20261021120300_reference_writes_caller_checks.down.sql
-- Dry run: supabase/dryrun/20261021120300_reference_writes_caller_checks.dryrun.sql
--
-- The routes, all open today:
--   - reference_requests: reference_requests_insert only checks created_by = auth.uid(), and the
--     status check allows 'confirmed'. A direct insert of a confirmed row, with any
--     partner_organization_id and a made-up signer, shows on that company's page.
--     reference_requests_update lets a creator set the status and the signer columns of its rows;
--   - reference_recipients: reference_recipients_insert lets a creator add a recipient whose token
--     hash it chose, then confirm through confirm_reference_by_token with no e-mail sent (the
--     recipients trigger's "select *" only stops this once 20261021120000 is applied, by accident);
--   - create_reference_request (SECURITY DEFINER, EXECUTE to PUBLIC and anon) trusts
--     p_partner_org_id and p_created_by: a visitor creates a request for any company, in the name
--     of any of its members (organization_members is readable by anon), and send-reference-email
--     (no caller check before this change) mails the link to an address of the visitor's domain.
-- This file:
--   - anon and authenticated lose INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on
--     reference_requests and reference_recipients. authenticated gets back UPDATE on
--     reference_requests.client_organization_id only. SELECT (20261021120000's subject) and
--     MAINTAIN are not touched; the service role and the table owner keep every privilege;
--   - the policies reference_requests_insert and reference_recipients_insert are dropped (no
--     privilege is left for them). reference_requests_update stays, for client_organization_id;
--   - create_reference_request refuses with 42501 unless the caller is signed in, p_created_by is
--     the caller, and the caller is a member of p_partner_org_id or staff (is_moderator()). The
--     rest of its body is unchanged. EXECUTE is revoked from PUBLIC and anon.
-- Client writes, grepped on 21 Oct on every branch (main 2a332cf8, refonte f952b592): only
-- ReferenceRequestForm.tsx, :164 the RPC (p_partner_org_id = the company from organization_members
-- via AuthContext, p_created_by = user.id) and :188 the UPDATE of client_organization_id WHERE id,
-- then :193 send-reference-email. No client writes reference_recipients or reference_events.
-- send-reference-email uses the service role (grants and RLS do not apply). Its caller check is
-- in the function (same commit; to deploy separately).
-- Not changed: reference_events (a creator can still add events to its own requests; nothing reads
-- them to decide anything); the confirm and reject RPCs.
-- Order: after 20261021120000, whose pre-check refuses any column grant on the table (this file
-- adds one). Independent of 20261021120100 and 20261021120200.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_fn regprocedure := to_regprocedure('public.create_reference_request(uuid, uuid, text, text, text, text, text, text, '
                                       || 'date, date, date, text, text, text, text, text, text)');
begin
  if not (has_table_privilege('authenticated', 'public.reference_requests', 'insert')
          and has_table_privilege('authenticated', 'public.reference_requests', 'update')
          and has_table_privilege('authenticated', 'public.reference_recipients', 'insert')) then
    raise exception 'reference writes: authenticated no longer holds INSERT and UPDATE on the two tables (applied already?)';
  end if;
  if (select count(*) from pg_policies p
       where p.schemaname = 'public' and p.cmd = 'INSERT' and p.roles = '{authenticated}'::name[]
         and ((p.tablename = 'reference_requests' and p.policyname = 'reference_requests_insert')
              or (p.tablename = 'reference_recipients' and p.policyname = 'reference_recipients_insert'))) <> 2 then
    raise exception 'reference writes: the policies reference_requests_insert / reference_recipients_insert are missing or changed';
  end if;
  if v_fn is null then
    raise exception 'reference writes: create_reference_request is missing or its arguments changed';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = v_fn) is distinct from '5c9884a8330cdab64303a2708932e903'
     or not (select p.prosecdef from pg_proc p where p.oid = v_fn)
     or (select p.proconfig::text from pg_proc p where p.oid = v_fn) is distinct from '{"search_path=public, pg_temp"}'
     or (select p.prorettype from pg_proc p where p.oid = v_fn) is distinct from 'public.reference_requests'::regtype::oid then
    raise exception 'reference writes: create_reference_request changed since this file was written (body, SECURITY DEFINER, search_path or return type)';
  end if;
  if not has_function_privilege('anon', v_fn, 'execute') then
    raise exception 'reference writes: anon cannot execute create_reference_request any more (applied already?)';
  end if;
end
$pre$;

revoke insert, update, delete, truncate, references, trigger on table public.reference_requests from anon, authenticated;
grant update (client_organization_id) on table public.reference_requests to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.reference_recipients from anon, authenticated;

drop policy reference_requests_insert on public.reference_requests;
drop policy reference_recipients_insert on public.reference_recipients;

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
  -- Caller check (20261021120300): signed in, in its own name, for its own company (or staff).
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR NOT (EXISTS (SELECT 1 FROM public.organization_members m
                      WHERE m.organization_id = p_partner_org_id AND m.user_id = auth.uid())
             OR public.is_moderator()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

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

revoke execute on function public.create_reference_request(uuid, uuid, text, text, text, text, text, text,
  date, date, date, text, text, text, text, text, text) from public, anon;

do $post$
declare
  v_fn regprocedure := to_regprocedure('public.create_reference_request(uuid, uuid, text, text, text, text, text, text, '
                                       || 'date, date, date, text, text, text, text, text, text)');
  v_r text;
begin
  foreach v_r in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_r, 'public.reference_requests', 'insert')
       or has_table_privilege(v_r, 'public.reference_requests', 'update')
       or has_table_privilege(v_r, 'public.reference_requests', 'delete')
       or has_table_privilege(v_r, 'public.reference_recipients', 'insert')
       or has_table_privilege(v_r, 'public.reference_recipients', 'update')
       or has_table_privilege(v_r, 'public.reference_recipients', 'delete')
       or has_column_privilege(v_r, 'public.reference_requests', 'status', 'update')
       or has_column_privilege(v_r, 'public.reference_requests', 'confirmed_signer_name', 'update') then
      raise exception 'reference writes: % still writes the tables (a grant through another role?)', v_r;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.reference_requests', 'client_organization_id', 'update')
     or has_column_privilege('anon', 'public.reference_requests', 'client_organization_id', 'update') then
    raise exception 'reference writes: UPDATE of client_organization_id is not authenticated-only';
  end if;
  if has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute')
     or not has_function_privilege('service_role', v_fn, 'execute')
     or strpos((select p.prosrc from pg_proc p where p.oid = v_fn), 'Caller check (20261021120300)') = 0 then
    raise exception 'reference writes: create_reference_request is not guarded as expected';
  end if;
end
$post$;
