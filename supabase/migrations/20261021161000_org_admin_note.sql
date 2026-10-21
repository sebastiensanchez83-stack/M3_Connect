-- Admin redesign, lane "members" (21 Oct 2026): what the new company page needs from the database.
-- NOT APPLIED. Apply with Victor's OK, after the dry run
-- supabase/dryrun/20261021161000_org_admin_note.dryrun.sql (it runs this file, cases, then its
-- down, in one rolled-back transaction). Down: supabase/migrations/down/20261021161000_org_admin_note.down.sql.
-- Independent of every other pending file; any order. The redesign's screens cope with it missing
-- (the Notes tab says "not set up yet", Accept / Refuse of a join request says so too).
--
-- ADDITIVE ONLY, harmless for the live site (main never names these objects):
--  1. public.org_admin_note: M3's internal notes on a company (organization_id) or on a person who
--     has no company (user_id); exactly one of the two. Never shown to members. Staff only:
--     is_moderator() (verified admins and moderators), the same test as review_log's reads.
--     Append-only: no update; a note is deleted by its author only. Grants explicit: PUBLIC and
--     anon get nothing; authenticated gets SELECT, INSERT, DELETE (the policies decide);
--     service_role everything.
--  2. Policy org_audit_staff_read on public.organization_audit_log: staff read a company's history.
--     Today only the company owner reads it (org_audit_select). One more SELECT policy, nothing else.
--  3. public.admin_decide_join_request(p_invitation_id, p_approve, p_note): M3 answers a join
--     request on the owner's behalf (company page, Members tab). Verified admins only (as
--     admin_remove_org_member). Approving follows approve_join_request in its go-live version
--     (held/signup_identity_golive.sql): a request the person filed themself, an address that is
--     confirmed AND proven; a suspended account stays suspended. Refusing = reject_join_request.
--     Each answer writes one review_log row (subject_type 'join'). EXECUTE: authenticated only.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.org_admin_note') is not null then
    raise exception 'org_admin_note: the table exists already (applied?)';
  end if;
  if to_regprocedure('public.admin_decide_join_request(uuid,boolean,text)') is not null then
    raise exception 'org_admin_note: admin_decide_join_request exists already (applied?)';
  end if;
  if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'organization_audit_log'
              and p.policyname = 'org_audit_staff_read') then
    raise exception 'org_admin_note: policy org_audit_staff_read exists already (applied?)';
  end if;
  if to_regprocedure('public.is_moderator()') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'org_admin_note: is_moderator() or is_admin() is missing';
  end if;
end
$pre$;

-- 1. Internal notes
create table public.org_admin_note (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint org_admin_note_one_subject check ((organization_id is null) <> (user_id is null)),
  constraint org_admin_note_body_len check (char_length(btrim(body)) between 1 and 4000)
);
comment on table public.org_admin_note is
  'M3 internal notes on a company (organization_id) or a person without a company (user_id). Staff only, never shown to members.';

create index org_admin_note_org_idx on public.org_admin_note (organization_id, created_at desc) where organization_id is not null;
create index org_admin_note_user_idx on public.org_admin_note (user_id, created_at desc) where user_id is not null;

alter table public.org_admin_note enable row level security;

revoke all on table public.org_admin_note from public, anon, authenticated;
grant select, insert, delete on table public.org_admin_note to authenticated;
grant all on table public.org_admin_note to service_role;

create policy org_admin_note_staff_read on public.org_admin_note
  for select to authenticated
  using ((select public.is_moderator()));

create policy org_admin_note_staff_write on public.org_admin_note
  for insert to authenticated
  with check ((select public.is_moderator()) and author_id = (select auth.uid()));

create policy org_admin_note_author_delete on public.org_admin_note
  for delete to authenticated
  using ((select public.is_moderator()) and author_id = (select auth.uid()));

-- 2. Staff read the company history
create policy org_audit_staff_read on public.organization_audit_log
  for select to authenticated
  using ((select public.is_moderator()));

-- 3. M3 answers a join request
create function public.admin_decide_join_request(p_invitation_id uuid, p_approve boolean, p_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_inv          record;
  v_requester_id uuid;
  v_org_verified boolean;
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Say whether to accept or refuse' using errcode = '22023';
  end if;

  select oi.id, oi.organization_id, oi.email, oi.status, oi.invited_by_user_id
    into v_inv
    from organization_invitations oi
   where oi.id = p_invitation_id
     for update;
  if not found then raise exception 'Join request not found' using errcode = 'P0002'; end if;
  if v_inv.status <> 'join_requested' then
    raise exception 'This request was already answered (now: %)', v_inv.status using errcode = '22023';
  end if;
  -- A row an owner wrote is an invitation: only the invited person can accept it.
  if v_inv.invited_by_user_id is not null then
    raise exception 'This is an invitation, not a join request: only the invited person can accept it' using errcode = '22023';
  end if;

  if not p_approve then
    update organization_invitations set status = 'rejected', updated_at = now() where id = p_invitation_id;
    insert into review_log (subject_type, subject_id, action, note, details, actor_id)
    values ('join', p_invitation_id, 'join_request_declined', nullif(btrim(coalesce(p_note, '')), ''),
            jsonb_build_object('source', 'admin_company_page', 'organization_id', v_inv.organization_id), auth.uid());
    return jsonb_build_object('ok', true, 'decision', 'refused', 'organization_id', v_inv.organization_id);
  end if;

  -- Only an account whose address is confirmed AND proven can be the requester.
  select u.id into v_requester_id
    from auth.users u
   where lower(u.email) = lower(v_inv.email) and u.email_confirmed_at is not null;
  if v_requester_id is null then
    raise exception 'No confirmed account uses this address' using errcode = 'P0002';
  end if;
  if not exists (select 1 from profiles p
                  where p.user_id = v_requester_id and p.email_proven_at is not null
                    and lower(p.email) = lower(v_inv.email)) then
    raise exception 'This person has not confirmed their email address yet. Ask them to use the link in the banner on their dashboard, then accept again.'
      using errcode = '22023';
  end if;

  update organization_invitations set status = 'accepted', updated_at = now() where id = p_invitation_id;
  insert into organization_members (user_id, organization_id, role)
  values (v_requester_id, v_inv.organization_id, 'collaborator')
  on conflict do nothing;

  select (o.access_status = 'verified') into v_org_verified from organizations o where o.id = v_inv.organization_id;
  if v_org_verified then
    update profiles set access_status = 'verified', onboarding_status = 'completed', updated_at = now()
     where user_id = v_requester_id and access_status <> 'suspended';
  else
    update profiles set onboarding_status = 'submitted', updated_at = now()
     where user_id = v_requester_id and access_status <> 'verified';
  end if;

  insert into review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('join', p_invitation_id, 'join_request_approved', nullif(btrim(coalesce(p_note, '')), ''),
          jsonb_build_object('source', 'admin_company_page', 'organization_id', v_inv.organization_id, 'user_id', v_requester_id),
          auth.uid());
  return jsonb_build_object('ok', true, 'decision', 'accepted', 'organization_id', v_inv.organization_id, 'user_id', v_requester_id);
end
$function$;

revoke all on function public.admin_decide_join_request(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_join_request(uuid, boolean, text) to authenticated;
