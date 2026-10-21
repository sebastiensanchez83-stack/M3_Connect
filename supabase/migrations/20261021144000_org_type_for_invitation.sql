-- public.org_type_for_invitation(p_invitation_id): the type of the company an invitation is for,
-- so the invitation sign-up page picks the right persona without reading organizations signed out
-- (privacy review of 21 Oct 2026, finding 1; go-live runbook P2).
-- Down: supabase/migrations/down/20261021144000_org_type_for_invitation.down.sql
-- Dry run: supabase/dryrun/20261021144000_org_type_for_invitation.dryrun.sql (this file, checks as
-- postgres, anon and an account M3 has not validated, then the down, in one rolled-back
-- transaction).
--
-- ADDITIVE, SAFE FOR MAIN. One read-only SECURITY DEFINER function; nothing existing changes.
--   - The invitation sign-up page (src/pages/JoinPage.tsx, handleSignup) runs signed out, before
--     the account exists, and reads organizations.organization_type of the inviting company to
--     choose the new account's persona. At go-live (held/directory_visitor_basic.sql) a company M3
--     has not validated is invisible to visitors, and the owners of such a company can send
--     invitations (owners_can_create_invitations): the read would find nothing, the page would
--     fall back to the persona 'marina', and accept_org_invitation never corrects it. Once M3
--     validates the person, they would get marina-only rights.
--   - Narrow on purpose: it answers only for an invitation that is still open (status 'pending',
--     not expired), keyed on its id (the secret of the e-mailed link, which
--     get_invitation_for_join already accepts), and returns the company type only, nothing else.
--   - Granted to anon and authenticated (the page runs signed out, and signed in after a login).
--     main does not call it.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regprocedure('public.org_type_for_invitation(uuid)') is not null then
    raise exception 'org_type_for_invitation: the function already exists';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public'
         and ((c.table_name = 'organization_invitations' and c.column_name in ('id', 'organization_id', 'status', 'expires_at'))
           or (c.table_name = 'organizations' and c.column_name in ('id', 'organization_type')))) <> 6 then
    raise exception 'org_type_for_invitation: a column it reads is missing';
  end if;
end
$pre$;

create function public.org_type_for_invitation(p_invitation_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select o.organization_type
    from public.organization_invitations oi
    join public.organizations o on o.id = oi.organization_id
   where oi.id = p_invitation_id
     and oi.status = 'pending'
     and oi.expires_at >= now()
   limit 1
$fn$;

comment on function public.org_type_for_invitation(uuid) is
  'The organization_type of the company an open invitation (status pending, not expired) is for, or null. For the invitation sign-up page, signed out: it chooses the new account''s persona. 20261021144000.';

revoke all on function public.org_type_for_invitation(uuid) from public;
grant execute on function public.org_type_for_invitation(uuid) to anon, authenticated, service_role;
