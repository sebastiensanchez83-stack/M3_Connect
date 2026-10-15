-- log_org_event(uuid, text, jsonb): no longer callable by visitors and members (fixer of the
-- Phase 3 integration, 15 Oct 2026). Independent of the Phase 3 parts; any order. NOT APPLIED.
-- Down: supabase/migrations/down/20261016093000_log_org_event_definer_only.down.sql.
-- Dry runs: supabase/dryrun/20261016093000_log_org_event_definer_only.dryrun.sql, .down.dryrun.sql.
--
-- public.log_org_event is SECURITY DEFINER and was EXECUTE-able by PUBLIC, anon and
-- authenticated: it inserts any event_type for any organization_id into organization_audit_log
-- without checking the caller, so anyone could forge a company's history. Phase 3's
-- Retro-review reads that log ('organization_auto_verified'), as earlier code reads
-- 'organization_pending_review' and 'ownership_claim_approved'.
-- Its callers (production, read 15 Oct): transfer_org_ownership, admin_set_org_claim_code,
-- create_organization and admin_set_org_owner, all SECURITY DEFINER owned by postgres, and the
-- Phase 3 definer functions admin_validate_person / admin_decide_claim. No client calls it
-- (neither main nor the redesign has rpc('log_org_event')), nor any edge function. A definer
-- function runs as its owner, who keeps EXECUTE: nothing changes for them or for the live site.
-- The service role keeps EXECUTE too.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_md5 text;
  v_bad text;
begin
  select md5(replace(p.prosrc, chr(13), '')) into v_md5
    from pg_proc p where p.oid = to_regprocedure('public.log_org_event(uuid,text,jsonb)');
  if v_md5 is distinct from 'f36ef2bcbab1e3396977f0c71c49c1e3' then
    raise exception 'log_org_event_definer_only: log_org_event changed (md5 %); check its callers again', v_md5;
  end if;
  -- A SECURITY INVOKER caller would run as the API role and lose it: refuse.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
   where p.prolang <> (select l.oid from pg_language l where l.lanname = 'c')
     and p.prosrc ilike '%log_org_event%'
     and p.oid <> to_regprocedure('public.log_org_event(uuid,text,jsonb)')
     and not p.prosecdef;
  if v_bad is not null then
    raise exception 'log_org_event_definer_only: callers that are not SECURITY DEFINER would lose it: %', v_bad;
  end if;
end
$pre$;

revoke all on function public.log_org_event(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_org_event(uuid, text, jsonb) to service_role;

-- After: every definer caller's owner still has EXECUTE (else the whole file rolls back).
do $post$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
   where p.prolang <> (select l.oid from pg_language l where l.lanname = 'c')
     and p.prosrc ilike '%log_org_event%'
     and p.oid <> to_regprocedure('public.log_org_event(uuid,text,jsonb)')
     and not has_function_privilege(p.proowner, 'public.log_org_event(uuid,text,jsonb)', 'execute');
  if v_bad is not null then
    raise exception 'log_org_event_definer_only: the owner of % would lose log_org_event', v_bad;
  end if;
end
$post$;
