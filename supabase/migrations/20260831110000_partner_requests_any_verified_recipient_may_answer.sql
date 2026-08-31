-- Applied to the remote project via the Supabase MCP; kept here for traceability.
-- B2B connection requests could only ever be ACCEPTED by someone whose persona
-- is 'marina'. True when the only shape was partner -> marina, but the network is
-- partner <-> partner too (the SM26 innovations introducing themselves to each
-- other) and for those the recipient hit "new row violates row-level security
-- policy" on Accept with no way through. Nine live requests were stuck there.
-- The two columns are the two SIDES of a request, not two personas.
drop policy if exists partner_requests_update on public.partner_requests;

create policy partner_requests_update on public.partner_requests
  for update to authenticated
  using (
    is_moderator()
    or marina_user_id = (select auth.uid())
    or partner_user_id = (select auth.uid())
  )
  with check (
    is_moderator()
    or (marina_user_id = (select auth.uid()) and is_verified(null::persona_enum)
        and status = any (array['accepted','rejected','pending']::partner_request_status_enum[]))
    or (partner_user_id = (select auth.uid()) and is_verified(null::persona_enum)
        and status = any (array['withdrawn','pending']::partner_request_status_enum[]))
  );
