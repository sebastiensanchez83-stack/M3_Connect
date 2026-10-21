-- public.org_by_email_domain(p_domain): the sign-up form's "your company is already here", without
-- reading organizations.primary_domain (go-live runbook P2 item 3).
-- Down: supabase/migrations/down/20261021142000_org_by_email_domain.down.sql
-- Dry run: supabase/dryrun/20261021142000_org_by_email_domain.dryrun.sql (this file, checks as
-- postgres, anon and a signed-in account, then the down, in one rolled-back transaction).
--
-- ADDITIVE, SAFE FOR MAIN. One read-only SECURITY DEFINER function; nothing existing changes.
--   - Today the sign-up form filters organizations on primary_domain signed out (refonte
--     SignupForm.tsx checkDomain, main SignupForm.tsx:174-177). At go-live anon loses
--     primary_domain (held/directory_visitor_basic.sql); the redesign calls this instead.
--   - Kept NARROW on purpose, since it answers anon (the form runs before the account exists):
--     exact match only on the lower-cased, trimmed domain (no like, no prefix, no list), a
--     validated company only (not archived, not merged), at most one row, and nothing but its
--     id, name and slug, which its public page already shows. It never returns the domain
--     itself, and an unknown domain answers no row, like a domain nobody uses.
--   - Granted to anon and authenticated (the form is signed out). If the front door stops
--     reaching the sign-up form signed out, revoke it from anon.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regprocedure('public.org_by_email_domain(text)') is not null then
    raise exception 'org_by_email_domain: the function already exists';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'organizations'
         and c.column_name in ('id', 'name', 'slug', 'primary_domain', 'access_status', 'archived_at', 'duplicate_of', 'created_at')) <> 8 then
    raise exception 'org_by_email_domain: a column it reads is missing';
  end if;
end
$pre$;

create function public.org_by_email_domain(p_domain text)
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.id, o.name, o.slug
    from public.organizations o
   where p_domain is not null
     and length(btrim(p_domain)) between 3 and 253
     and o.primary_domain is not null
     and lower(btrim(o.primary_domain)) = lower(btrim(p_domain))
     and o.access_status = 'verified'
     and o.archived_at is null
     and o.duplicate_of is null
   order by o.created_at, o.id
   limit 1
$fn$;

comment on function public.org_by_email_domain(text) is
  'The validated, listed company whose primary_domain is exactly this e-mail domain (lower-cased, trimmed): id, name, slug, at most one row. For the sign-up form, signed out. 20261021142000.';

revoke all on function public.org_by_email_domain(text) from public;
grant execute on function public.org_by_email_domain(text) to anon, authenticated, service_role;
