-- "Did I take part in Smart Marina 2026?" for the member dashboard (read-only).
-- Victor, 9 Oct 2026: "I don't see that I took part in Smart Marina, or that a
-- member of my team took part, from the dashboard."
--
-- NOT APPLIED. Written by the dashboard redesign (branch rf-dash); apply it with
-- the Supabase MCP / dashboard when the branch ships. The front end works
-- without it (it falls back to plain reads, see src/lib/sm26Participation.ts):
-- this only closes the gap below.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- sm_attendee and sm_registration are readable through
-- sm_can_access_registration(): the registration's owner, a member of its
-- organisation, or staff. An attendee who was put on a registration by a
-- company they are NOT a member of cannot read their own attendee row: on
-- 9 Oct 2026, 9 of the 101 attendees linked to an account (attending, on a
-- confirmed SM26 registration) were in that case, so the dashboard could not
-- tell them they attended.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What
-- ════════════════════════════════════════════════════════════════════════════
-- One function that answers for the caller only, with a yes / no, and exposes
-- nothing else (no registration, no other attendee):
--   true  = the caller is an attendee (attending = true) of a confirmed SM26
--           registration, or owns a confirmed SM26 registration.
-- `attending` is NOT NULL DEFAULT true; false marks someone who was replaced or
-- did not come (11 rows on confirmed registrations on 9 Oct 2026).
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
    where e.slug = 'sm26'
      and (
        r.user_id = auth.uid()
        or exists (
          select 1 from public.sm_attendee a
          where a.registration_id = r.id and a.user_id = auth.uid() and a.attending
        )
      )
  );
$$;

revoke all on function public.sm_my_sm26_participation() from public, anon;
grant execute on function public.sm_my_sm26_participation() to authenticated;

comment on function public.sm_my_sm26_participation() is
  'Member dashboard: true when the caller attended SM26 (attendee of a confirmed registration, or its owner). Caller only, yes/no.';

-- Undo:
--   drop function if exists public.sm_my_sm26_participation();
