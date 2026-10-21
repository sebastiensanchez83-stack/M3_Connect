-- DOWN for supabase/migrations/20261021140000_org_is_claimed.sql
-- Drops organizations.is_claimed (its column grants go with it). The redesign falls back to
-- owner_user_id when the column is missing (src/lib/orgVisibility.ts), so its pages keep working
-- as long as anon still reads owner_user_id.
-- NEVER run this while supabase/migrations/held/directory_visitor_basic.sql is applied: that file
-- takes owner_user_id away from anon, so the fallback would fail and the directory, the home page
-- and every company page would break for visitors. Run that file's down first.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  -- The held file leaves anon without owner_user_id: refuse.
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'owner_user_id')
     and not has_column_privilege('anon', 'public.organizations', 'owner_user_id', 'select') then
    raise exception 'org_is_claimed down: anon cannot read owner_user_id (held/directory_visitor_basic.sql is applied); run its down first';
  end if;
  -- Nothing in the database may depend on the column (a view, a policy, a function body).
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ilike '%is_claimed%'
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c');
  if v_bad is not null then
    raise exception 'org_is_claimed down: function(s) read is_claimed: %', v_bad;
  end if;
  if exists (select 1 from pg_policies pl where pl.schemaname = 'public'
              and (coalesce(pl.qual, '') ilike '%is_claimed%' or coalesce(pl.with_check, '') ilike '%is_claimed%')) then
    raise exception 'org_is_claimed down: a policy reads is_claimed';
  end if;
end
$pre$;

alter table public.organizations drop column if exists is_claimed;
