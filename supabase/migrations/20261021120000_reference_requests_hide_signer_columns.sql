-- Hole 1 of 3 of the go-live runbook (P2.4, Q8 = a), 21 Oct 2026: visitors AND signed-in
-- accounts read the signer's e-mail and the verification code of every confirmed recommendation.
-- Down: supabase/migrations/down/20261021120000_reference_requests_hide_signer_columns.down.sql
-- Dry run: supabase/dryrun/20261021120000_reference_requests_hide_signer_columns.dryrun.sql
-- (runs this file, every client read of the table as its real role, then the down, in one
-- rolled-back transaction).
--
-- The policy reference_requests_public_select_confirmed lets {anon, authenticated} read every
-- confirmed row, and both roles hold table-level SELECT, so both read confirmed_signer_email and
-- verification_code. This file swaps the table-level SELECT of these two roles for column grants:
--   - anon: the 8 columns the company page reads signed out: client_legal_name, client_country,
--     project_name, confirmed_signer_name, confirmed_signer_title, confirmed_at, and its two
--     filter columns partner_organization_id and status;
--   - authenticated: every column except confirmed_signer_email and verification_code.
-- Client reads, grepped on 21 Oct (main 2a332cf8, refonte 02559e58): each one names its columns,
-- none reads the two columns, none uses select('*'):
--   main:    AdminUserDetail.tsx:193, AdminUsers.tsx:136, InboxTab.tsx:127,
--            ReferenceRequestForm.tsx:52 (and its update at :188, WHERE id),
--            AccountPage.tsx:543 and :705 (count of id), OrganizationPublicPage.tsx:384;
--   refonte: AdminUserDetail.tsx:206, AdminUsers.tsx:155, useDashboardData.ts:222,
--            ReferenceRequestForm.tsx:52 (and :188), OrganizationPublicPage.tsx:548.
--   The /reference/confirm and /reference/reject pages only call the RPCs below.
-- Unchanged: the RLS policies; the other table privileges of anon and authenticated; the service
-- role (send-reference-email reads select('*') with it); the writes, which go through
-- create_reference_request, confirm_reference_by_token and reject_reference_by_token, all
-- SECURITY DEFINER (their owner keeps every privilege).
-- Later columns: a column added to this table is NOT readable by authenticated or anon until it
-- is granted (there is no table-level SELECT any more).
-- Side effect, no client concerned: the trigger validate_recipient_domain (SECURITY INVOKER,
-- "select *" from this table) now stops a signed-in account's direct insert into
-- reference_recipients with 42501. Recipients are only inserted by send-reference-email (service
-- role).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_cols text;
begin
  select string_agg(a.attname::text, ',' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from 'id,reference_id,verification_code,partner_organization_id,created_by,'
       || 'client_organization_id,client_legal_name,client_country,client_website,client_primary_domain,'
       || 'project_name,project_location,project_start_date,project_end_date,project_delivery_date,'
       || 'contract_reference,solution_product,scope_description,results_summary,key_kpis,'
       || 'recommendation_statement,status,confirmed_signer_name,confirmed_signer_title,'
       || 'confirmed_signer_email,confirmed_at,expires_at,created_at,updated_at' then
    raise exception 'reference_requests: the columns changed since this file was written: %', v_cols;
  end if;
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'public.reference_requests'::regclass and a.attnum > 0 and a.attacl is not null) then
    raise exception 'reference_requests: column grants exist already (applied twice?)';
  end if;
  if not (has_table_privilege('anon', 'public.reference_requests', 'select')
          and has_table_privilege('authenticated', 'public.reference_requests', 'select')) then
    raise exception 'reference_requests: anon or authenticated has no table-level SELECT (applied already?)';
  end if;
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('create_reference_request', 'confirm_reference_by_token', 'reject_reference_by_token')
         and p.prosecdef) <> 3 then
    raise exception 'reference_requests: a write function is missing, doubled or no longer SECURITY DEFINER';
  end if;
end
$pre$;

revoke select on table public.reference_requests from anon, authenticated;

grant select (client_legal_name, client_country, project_name, confirmed_signer_name, confirmed_signer_title,
              confirmed_at, partner_organization_id, status)
  on table public.reference_requests to anon;

grant select (id, reference_id, partner_organization_id, created_by, client_organization_id, client_legal_name,
              client_country, client_website, client_primary_domain, project_name, project_location,
              project_start_date, project_end_date, project_delivery_date, contract_reference, solution_product,
              scope_description, results_summary, key_kpis, recommendation_statement, status,
              confirmed_signer_name, confirmed_signer_title, confirmed_at, expires_at, created_at, updated_at)
  on table public.reference_requests to authenticated;

do $post$
begin
  if has_column_privilege('anon', 'public.reference_requests', 'confirmed_signer_email', 'select')
     or has_column_privilege('anon', 'public.reference_requests', 'verification_code', 'select')
     or has_column_privilege('authenticated', 'public.reference_requests', 'confirmed_signer_email', 'select')
     or has_column_privilege('authenticated', 'public.reference_requests', 'verification_code', 'select') then
    raise exception 'reference_requests: the two columns are still readable (a grant through another role?)';
  end if;
end
$post$;
