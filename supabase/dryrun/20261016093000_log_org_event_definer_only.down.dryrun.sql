-- DRY RUN of the DOWN of supabase/migrations/20261016093000_log_org_event_definer_only.sql. NOT A
-- MIGRATION. ONE query text, ONE execute_sql call, BEFORE that file is applied: snapshot, the
-- migration verbatim, the down verbatim, then checks that production is back. Ends with RAISE
-- EXCEPTION 'DRYRUN ...'. Expected: "2 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot ─────────────────────────────────────────────────────────────────
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'audit', (select count(*)::text from public.organization_audit_log)
  union all select 'other_acls', (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proacl, ','), ''), ';' order by p.oid::regprocedure::text))
                                    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'log_org_event')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();
-- The EXECUTE list of log_org_event, item by item (the order of an ACL may change).
create temp table _dr_acl on commit drop as
  select coalesce(array_agg(x order by x), '{}') as acl
    from (select unnest(p.proacl)::text as x from pg_proc p where p.oid = 'public.log_org_event(uuid,text,jsonb)'::regprocedure) s;

-- ─── B. The migration, verbatim ─────────────────────────────────────────────────
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

-- ─── C. The down, verbatim ──────────────────────────────────────────────────────
-- DOWN for supabase/migrations/20261016093000_log_org_event_definer_only.sql
-- Puts back production's EXECUTE on public.log_org_event (PUBLIC, anon, authenticated; the
-- service role and the owner kept it). Any time.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

grant execute on function public.log_org_event(uuid, text, jsonb) to public, anon, authenticated;

-- ─── Checks ─────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  c record;
begin
  for c in
    select * from (values
      ('D01', 'log_org_event has production''s EXECUTE list again (PUBLIC, anon, authenticated, service role, owner)',
       (select coalesce(array_agg(x order by x), '{}')
          from (select unnest(p.proacl)::text as x from pg_proc p where p.oid = 'public.log_org_event(uuid,text,jsonb)'::regprocedure) s)
       = (select acl from _dr_acl)),
      ('D02', 'no row and no other function''s EXECUTE changed',
       not exists ((select * from _dr_before except select * from pg_temp.dr_snap())
                   union all (select * from pg_temp.dr_snap() except select * from _dr_before)))
    ) as x(id, label, ok)
  loop
    if coalesce(c.ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s: %s', case when coalesce(c.ok, false) then 'PASS' else 'FAIL' end, c.id, c.label);
  end loop;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (log_org_event_definer_only down dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
