-- "Did I attend Smart Marina 2026?" for the member dashboard (read-only).
-- Victor, 9 Oct 2026: "I don't see that I took part in Smart Marina, or that a
-- member of my team took part, from the dashboard."
--
-- NOT APPLIED. Written by the dashboard redesign (branch rf-dash); apply it with
-- the Supabase MCP / dashboard in the same release as the front end. The front
-- end works without it (plain reads, see src/lib/sm26Participation.ts; the
-- missing function is asked once per browser tab): this only closes the gap
-- below.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- sm_attendee and sm_registration are readable through
-- sm_can_access_registration(): the registration's owner, a member of its
-- organisation, or staff. An attendee who was put on a registration by a
-- company they are NOT a member of cannot read their own attendee row: on
-- 9 Oct 2026, 9 of the 100 accounts listed as attending on a confirmed SM26
-- registration could read none of their attending rows, so the dashboard could
-- not tell them they attended.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What
-- ════════════════════════════════════════════════════════════════════════════
-- One function that answers for the caller only, with a yes / no, and exposes
-- nothing else (no registration, no other attendee):
--   true  = the caller is listed as attending (attending = true) on a
--           confirmed SM26 registration.
-- Owning a registration is NOT enough: `attending` is NOT NULL DEFAULT true,
-- and false marks someone who was replaced or did not come (11 registration
-- owners are marked false on their own registration). Owners can always read
-- their own registration, so the front end tells them "your company took part"
-- without this function.
-- No table, no policy, no data change.

create or replace function public.sm_my_sm26_participation()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.sm_event e
    join public.sm_registration r on r.event_id = e.id and r.status = 'confirmed'
    join public.sm_attendee a on a.registration_id = r.id
    where e.slug = 'sm26'
      and a.user_id = auth.uid()
      and a.attending
  );
$$;

revoke all on function public.sm_my_sm26_participation() from public, anon;
grant execute on function public.sm_my_sm26_participation() to authenticated;

comment on function public.sm_my_sm26_participation() is
  'Member dashboard: true when the caller is listed as attending on a confirmed SM26 registration. Caller only, yes/no.';

-- Undo:
--   drop function if exists public.sm_my_sm26_participation();
