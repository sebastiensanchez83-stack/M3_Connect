-- Self-service INSERTs into public.organizations can no longer set the trust,
-- money and identity columns (access_status, tier, max_seats, featured_partner,
-- claim_code, rejection_reason).
-- Audit S9 follow-up (Phase 0, security), track "email-functions", 7 Oct 2026.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- trg_guard_org_sensitive (guard_org_sensitive_columns) is BEFORE UPDATE only.
-- RLS org_insert only checks created_by_user_id = owner_user_id = auth.uid(), and
-- authenticated holds INSERT on every column. So any signed-in account can send
--     POST /rest/v1/organizations
--     {"name":"X","slug":"x-1","created_by_user_id":"<me>","owner_user_id":"<me>",
--      "access_status":"verified","tier":"main_sponsor","max_seats":999}
-- and own an organisation that looks verified by M3. Consequences:
--   * send-notification (this track) treats an organisation that M3 has NOT
--     verified as untrusted: generic subject, 5 e-mails per organisation and 50
--     in total per 24 h. A self-inserted 'verified' row would skip those limits.
--   * accept_org_invitation / approve_join_request verify the PROFILE of anyone who
--     joins a verified organisation. With a second account, a self-inserted
--     'verified' organisation therefore verifies an account without M3's review.
--   * Submission pages and tier entitlements read organizations.access_status /
--     tier.
-- Not executed (read-only work); the rows check below shows the exposure.
--
-- The UPDATE guard already says "NO self-service user may change these, INCLUDING
-- org owners". This adds the same rule for INSERT, as a separate function and
-- trigger so the UPDATE guard is not touched.
--
-- Who is affected: only a direct INSERT by the 'authenticated' role from a
-- non-moderator. The app never does that: OnboardingPage and OrganizationTab call
-- create_organization() (SECURITY DEFINER, runs as postgres, so current_user is
-- not 'authenticated' and the trigger lets it through, including its own
-- verify-if-creator-is-verified UPDATE). Edge functions (sm26-provision,
-- claim-code-signup, ...) use the service role and pass through too. Verified
-- moderators and admins pass through (is_moderator()). The values forced below are
-- exactly the column defaults create_organization() ends up with.
-- No SM26 (sm_*) or WYS (gl_*) object is read or written. No existing row changes.
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   Exposure: no column or log records who set access_status / tier, so a past
--   self-insert cannot be told apart from an M3 verification. Production, 7 Oct
--   2026: 278 organisations; 94 were created by non-staff accounts and are verified
--   or on a paid tier (expected: M3 verifies them in the admin panel); 58 of those
--   have no 'organization_created' row in organization_audit_log (SM26 provisioning
--   and pre-audit-log rows also lack it). List to eyeball, nothing more:
--     select o.id, o.name, o.access_status, o.tier, o.created_at
--       from public.organizations o
--       join public.profiles p on p.user_id = o.created_by_user_id
--      where p.persona not in ('admin','moderator')
--        and (o.access_status = 'verified' or o.tier <> 'member')
--      order by o.created_at desc;
--   After:
--     select tgname, tgenabled from pg_trigger
--      where tgrelid = 'public.organizations'::regclass and tgname = 'trg_guard_org_sensitive_insert';
--       -> one row, 'O'
--     Proof inside a rolled-back transaction (as a non-staff user):
--       begin;
--       set local role authenticated;
--       select set_config('request.jwt.claims', json_build_object('sub','<non-staff user id>','role','authenticated')::text, true);
--       insert into public.organizations (name, slug, created_by_user_id, owner_user_id, access_status, tier, max_seats)
--       values ('guard test', 'guard-test-' || gen_random_uuid(), '<same id>', '<same id>', 'verified', 'main_sponsor', 99)
--       returning access_status, tier, max_seats;   -- pending, member, 1
--       rollback;
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO
-- ════════════════════════════════════════════════════════════════════════════
--   DROP TRIGGER IF EXISTS trg_guard_org_sensitive_insert ON public.organizations;
--   DROP FUNCTION IF EXISTS public.guard_org_insert_sensitive_columns();

CREATE OR REPLACE FUNCTION public.guard_org_insert_sensitive_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- SECURITY INVOKER on purpose, like guard_org_sensitive_columns(): inside
  -- SECURITY DEFINER RPCs (create_organization, ...) and for the service role,
  -- current_user is not 'authenticated' and the row is left alone.
  if current_user <> 'authenticated' then return new; end if;
  -- Verified moderators/admins may set anything.
  if is_moderator() then return new; end if;

  -- Self-service creation always starts unverified, on the free tier.
  new.access_status    := 'pending';
  new.tier             := 'member';
  new.max_seats        := 1;
  new.featured_partner := false;
  new.claim_code       := null;
  new.rejection_reason := null;
  return new;
end
$function$;

COMMENT ON FUNCTION public.guard_org_insert_sensitive_columns() IS
  'BEFORE INSERT on organizations: a self-service insert (role authenticated, not a verified moderator/admin) cannot set access_status, tier, max_seats, featured_partner, claim_code or rejection_reason. Audit S9 follow-up, 2026-10-07.';

-- No REVOKE: like guard_org_sensitive_columns(), a trigger function cannot be called
-- through /rest/v1/rpc, and the ACL is left as for the existing guard.

DROP TRIGGER IF EXISTS trg_guard_org_sensitive_insert ON public.organizations;
CREATE TRIGGER trg_guard_org_sensitive_insert
  BEFORE INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_org_insert_sensitive_columns();
