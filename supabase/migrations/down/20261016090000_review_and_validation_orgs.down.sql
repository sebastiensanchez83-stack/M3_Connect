-- DOWN for supabase/migrations/20261016090000_review_and_validation_orgs.sql
-- Run the downs in reverse order: queue, then people, then this one (checked below).
-- Puts back: the organization guard (production text, md5 1bb4a8fb...),
-- the two-kind CHECK of notification_outbox (NOT VALID while decision e-mails exist), anon's
-- EXECUTE on get_public_profiles, and drops the new functions and the two listing columns
-- (the archived / duplicate marks set by M3 in between are lost; review_log keeps them).
-- Before this down, also revert the redesign's reads of the new columns (contract §11.6:
-- .is('archived_at', null) / .is('duplicate_of', null) answer 400 once the columns are gone)
-- and of org_public_member_counts; refused while held/directory_signed_in_only.sql is applied
-- (signed-out member counts then depend on org_public_member_counts).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_members'
                  and p.policyname = 'org_members_select_public') then
    raise exception 'down orgs: held/directory_signed_in_only.sql is applied; run supabase/migrations/down/directory_signed_in_only.down.sql first';
  end if;
  if to_regprocedure('public.admin_validate_person(uuid,jsonb)') is not null then
    raise exception 'down orgs: run supabase/migrations/down/20261016090500_review_and_validation_people.down.sql first';
  end if;
  if to_regprocedure('public.review_queue_rows(boolean,boolean)') is not null then
    raise exception 'down orgs: run supabase/migrations/down/20261016091000_review_and_validation_queue.down.sql first';
  end if;
end
$pre$;

drop function if exists public.org_public_member_counts(uuid[]);
drop function if exists public.admin_mark_duplicate_org(uuid, uuid, text);
drop function if exists public.admin_archive_org(uuid, boolean, text);
drop function if exists public.person_match_candidates(text, text, text, text);
drop function if exists public.org_match_candidates(text, text, text, text);
drop function if exists public.review_name_key(text, text);
drop function if exists public.review_domain_match(text, text);
drop function if exists public.review_url_host(text);

create or replace function public.guard_org_sensitive_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- SECURITY DEFINER / service-role contexts (create_organization,
  -- claim_organization, update_org_branding, sync_org_entitlements, admin RPCs)
  -- run as a non-API role -- let them through.
  if current_user <> 'authenticated' then return new; end if;
  -- Verified moderators/admins may change anything.
  if is_moderator() then return new; end if;

  -- Money / trust / identity columns: NO self-service user may change these,
  -- INCLUDING org owners. Closes the owner self-verify + self-tier-upgrade path.
  new.tier := old.tier;
  new.access_status := old.access_status;
  new.max_seats := old.max_seats;
  new.featured_partner := old.featured_partner;
  new.owner_user_id := old.owner_user_id;
  new.created_by_user_id := old.created_by_user_id;
  new.claim_code := old.claim_code;
  new.slug := old.slug;
  new.rejection_reason := old.rejection_reason;

  -- Structural columns only OWNERS may change (owners legitimately advance
  -- onboarding_status during the wizard and toggle domain auto-join; members cannot).
  if not is_org_owner(old.id) then
    new.onboarding_status := old.onboarding_status;
    new.primary_domain := old.primary_domain;
    new.auto_approve_domain_joins := old.auto_approve_domain_joins;
    new.organization_type := old.organization_type;
  end if;
  return new;
end
$function$;

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('account_under_review', 'team_join_request')) not valid;
do $v$
begin
  if not exists (select 1 from public.notification_outbox n where n.kind not in ('account_under_review', 'team_join_request')) then
    alter table public.notification_outbox validate constraint notification_outbox_kind_check;
  else
    raise notice 'down orgs: decision e-mails are kept in notification_outbox; the kind CHECK stays NOT VALID';
  end if;
end
$v$;

grant execute on function public.get_public_profiles(uuid[]) to public, anon;

drop index if exists public.organizations_duplicate_of_idx;
alter table public.organizations drop constraint if exists organizations_duplicate_of_not_self;
alter table public.organizations drop constraint if exists organizations_duplicate_of_fkey;
alter table public.organizations drop column if exists duplicate_of;
alter table public.organizations drop column if exists archived_at;
