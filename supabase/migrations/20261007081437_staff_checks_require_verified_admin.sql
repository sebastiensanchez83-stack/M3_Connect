-- Staff power requires a VERIFIED admin/moderator, everywhere. The profile guard
-- trigger, which has never fired, now works and also protects staff profiles.
-- Audit item S1, part 2 (Phase 0, security).
--
-- ════════════════════════════════════════════════════════════════════════════
-- READ FIRST: a hole worse than S1 (found while re-checking the trigger)
-- ════════════════════════════════════════════════════════════════════════════
-- public.prevent_profile_privilege_escalation() (BEFORE UPDATE trigger
-- trg_prevent_profile_privilege_escalation on public.profiles) is meant to stop a
-- user changing their own persona / access_status. Its test is
--     IF current_user = 'authenticated' AND auth.uid() = OLD.user_id AND NOT is_admin()
-- but the function is SECURITY DEFINER, owned by postgres. Inside a SECURITY
-- DEFINER function current_user is the function's OWNER (PostgreSQL docs,
-- "current_user ... also changes during the execution of functions with the
-- attribute SECURITY DEFINER"). So current_user is always 'postgres' here, the
-- test is always false, and the trigger has never reverted anything. Every other
-- guard trigger in this schema that tests current_user (guard_org_sensitive_columns,
-- sm_attendee_guard, sm_guard_reg_columns, sm_guard_role_assignment,
-- sm_architecture_freeze_renders) is SECURITY INVOKER and works; this one is the
-- only SECURITY DEFINER one.
-- Consequence today: policy profiles_update_own_or_moderator lets a user update
-- their own row (user_id = auth.uid()), authenticated holds a table-level UPDATE
-- grant, and nothing else checks the columns. So any signed-in account can send
--     PATCH /rest/v1/profiles?user_id=eq.<own id>  {"persona":"admin","access_status":"verified"}
-- and is a verified admin: is_admin(), is_moderator(), sm_is_staff() all true.
-- No sign-up trick, no other step, "Confirm email" irrelevant. The same PATCH with
-- only {"access_status":"verified"} skips M3's review for any persona.
-- Not executed (database is read-only for this work); the proof script at the
-- bottom of this header shows it inside a rolled-back transaction.
-- Since when: 20260709143650_p1_audit_batch_onboarding_join_claim_restart
-- (9 Jul 2026). It added the `current_user = 'authenticated'` test so that
-- RPCs could verify-on-join, but kept SECURITY DEFINER. Before it, the trigger had
-- no current_user test and did freeze self-writes (since 20260305114607).
-- Exposure check, production, 7 Oct 2026 (read-only; no audit column records who
-- set access_status, so this shows that a legitimate path exists for every row):
--   staff: 6 admins, all @m3monaco.com; 0 moderators.
--   non-staff: 128 verified profiles, 0 without a legitimate verification path
--   (query E1 below): 113 are in a verified organization; the other 15 are
--   14 SM26 accounts (confirmed registration -> sm26-provision, or attendee of a
--   confirmed registration -> sm26-attendee-invite) and 1 partner whose accepted
--   org invitation verified it on 23 Jul (its membership was removed later).
--   0 verified profiles whose persona matches neither the sign-up persona, an
--   organization they belong to, nor an SM26 provisioning (query E2).
-- pg_stat_statements is no evidence either way: a self-PATCH has the same
-- statement shape as an admin-panel approve.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration changes (4 parts)
-- ════════════════════════════════════════════════════════════════════════════
--
-- PART 1. Six RLS policies trusted persona alone (no access_status check). A
-- persona 'admin' or 'moderator' account that was still pending (the S1 sign-up
-- path before 20261006214217, or the PATCH above) could read, change and delete
-- the 18 organization_documents rows, and read/update payments, rfps,
-- consultations and marina_projects (those four tables are empty today). Each now
-- uses public.is_moderator(), which is is_verified('admin') OR
-- is_verified('moderator'). Intent unchanged: "admin or moderator", now verified.
-- Command, roles (public) and the absent WITH CHECK are kept: ALTER POLICY only
-- touches USING.
--     organization_documents.admin_view_all_docs   ALL
--     payments.admin_read_all_payments             SELECT
--     payments.admin_update_payments               UPDATE
--     rfps.admin_update_rfps                       UPDATE
--     consultations.admin_update_consultations     UPDATE
--     marina_projects.admin_update_marina_projects UPDATE
--
-- PART 2. refresh_pulse_snapshot() (SECURITY DEFINER, executable by anon and
-- authenticated) checked persona only:
--     SELECT persona INTO caller_persona FROM profiles WHERE user_id = auth.uid();
--     IF caller_persona NOT IN ('admin','moderator') THEN RAISE ...
-- An unverified staff persona passed. And a caller with NO profile (anon, or a
-- service-role key) passed too, because NULL NOT IN (...) is NULL and IF NULL
-- does not raise: anyone could trigger the snapshot upsert. Now:
-- IF NOT public.is_moderator(). Only caller: src/components/admin/AdminPulse.tsx
-- (admin screen, verified admins). The nightly cron "daily-pulse-snapshot" does
-- not call it (it inlines the INSERT as postgres).
--
-- PART 3. compute_pulse_snapshot() (SECURITY DEFINER, no caller check) returns
-- the whole admin Industry Pulse payload. The 29 July pass revoked it from
-- PUBLIC/anon but left the explicit grant to authenticated, so any signed-in
-- account, pending ones included, can read the admin-only dashboard data that
-- the policy pulse_snapshots.pulse_select_admin hides. EXECUTE is revoked from
-- authenticated. Callers checked: refresh_pulse_snapshot() runs as its owner
-- (postgres) and keeps EXECUTE; the cron job runs as postgres; no client or
-- edge function calls compute_pulse_snapshot directly (grep src/ and
-- supabase/functions/). service_role keeps its grant.
--
-- PART 4. The profile guard trigger, fixed and extended (no parallel trigger).
--   a) SECURITY INVOKER instead of SECURITY DEFINER. This is the actual fix: now
--      current_user is the role doing the write. A direct PostgREST write by a
--      user is 'authenticated'; inside a SECURITY DEFINER RPC (claim_organization,
--      accept_org_invitation, approve_join_request, handle_new_user, ...) it is the
--      RPC owner, postgres; an edge function on the service key is 'service_role'.
--      The body only calls public.is_admin(), auth.uid() and auth.role(), which
--      anon/authenticated can execute, so it needs no elevated rights.
--   b) Self-freeze (the trigger's original, documented intent, now enforced):
--      a user's own direct API write cannot change their persona or access_status
--      (silently kept, as before), unless they are a verified admin. A direct API
--      INSERT of a profile by a non-admin gets access_status 'pending' (persona is
--      already limited by policy profiles_insert). Every auth user already has a
--      profile (0 without one, user_id is the primary key), so the INSERT branch is
--      belt and braces; the trigger now fires BEFORE INSERT OR UPDATE.
--   c) Staff guard (new): a row may become a staff row (persona changed to, or
--      inserted as, 'admin'/'moderator') or a staff row may become 'verified' ONLY
--      when the writer is
--        - the service role (edge functions on the service key), or
--        - a verified admin (public.is_admin(), from the JWT, so it also holds
--          inside SECURITY DEFINER RPCs), or
--        - a database session with no API JWT at all (migrations, SQL editor, cron).
--      Otherwise it RAISES 42501. This closes the S1 chain end to end whatever
--      the path: an unverified staff persona can no longer be verified by
--      accept_org_invitation, approve_join_request or any other RPC run by a
--      non-admin.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Callers checked (legitimate flows that must keep working)
-- ════════════════════════════════════════════════════════════════════════════
-- Client writes to profiles (grep of src/, every .from('profiles').update/insert):
--   * AccountPage.tsx:401-408 (name/job title), :450 (avatar_url),
--     NotificationPreferencesTab.tsx:106 (notification_prefs), OnboardingPage.tsx:379
--     (names + onboarding_status), :436/:475/:516/:756 and OrganizationTab.tsx:678
--     (onboarding_status): no persona/access_status, unaffected.
--   * OnboardingPage.tsx:534 INSERT persona + access_status 'pending': allowed,
--     stays 'pending'.
--   * OnboardingPage.tsx:431-433 and :511-513 self-set access_status 'verified'
--     after a domain auto-join. Now silently kept as before by the self-freeze. Not a
--     working flow today: both handlers are dead code and their membership insert is
--     refused by org_members_insert (owners only) since
--     20261006174500_org_membership_trusts_verified_auth_email_only. Production: 0
--     non-verified members of verified auto-approve organizations, and that UPDATE
--     shape is absent from pg_stat_statements.
--   * Admin panel, verified admins acting on OTHER users: AdminUsers.tsx:195, 209,
--     226, 233 and AdminUserDetail.tsx:213, 227, 255, 282 (approve, reject,
--     suspend, change persona incl. to admin). Self-freeze does not apply (not
--     their own row); staff guard passes (is_admin()). Unchanged.
-- Edge functions writing persona/access_status, all on the service-role client
-- (staff guard passes, self-freeze does not apply): create-admin-user (repo and
-- deployed v13: persona 'admin' + 'verified'), sponsor-invite (deployed v2, never
-- touches staff rows), sm26-provision, sm26-attendee-invite, payment-ipn.
-- Database functions that update profiles (run as postgres; self-freeze does not
-- apply; staff guard applies by JWT):
--   * accept_org_invitation, approve_join_request: set 'verified'. A staff-persona
--     user who is already verified is unchanged (no transition). Only an
--     UNVERIFIED staff persona is refused, i.e. exactly the S1 chain.
--   * claim_organization / claim_organization_for_user: set persona to the
--     organization's type; the CHECK constraint on organizations.organization_type
--     allows only marina, partner, media_partner, developer, investor, never staff.
--   * sm_registration_withdrawal_sync: only persona 'individual' -> 'rejected'.
--   * handle_new_user: whitelisted persona, 'pending'.
-- Staff today: 6 verified admins (all keep every access: is_moderator() and
-- is_admin() are true for them), 0 moderators. No profile with a staff persona is
-- unverified, so no existing row is refused anything.
--
-- Audited, NOT changed (they already require 'verified', or are not staff checks):
--   admin_add_org_member, admin_remove_org_member, admin_user_orgs,
--   sm_is_staff, sm_investor_portfolio, and the policies
--   admin_impersonation_log_read, platform_settings "Admins can manage platform
--   settings", pulse_select_admin, sm_event_admin, sm_notification_insert/_select,
--   sm_role_requirement_admin: persona AND access_status = 'verified'.
--   admin_get_profiles, admin_get_profiles_by_ids, get_unconfirmed_users,
--   has_marketplace_access, is_partner_like: is_moderator() / verified.
--   Non-staff persona trust left for a product decision (see report):
--   is_media_user() (unverified 'media_partner' reads press resources) and
--   partners.partners_insert_owner_or_moderator (pending partner creates own listing).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Proof / check script (SQL editor, as postgres). Everything is rolled back.
-- ════════════════════════════════════════════════════════════════════════════
--   begin;
--   select set_config('request.jwt.claims',
--     (select json_build_object('sub', user_id, 'role', 'authenticated')::text
--        from public.profiles where persona = 'individual' and access_status = 'pending'
--        limit 1), true);
--   set local role authenticated;
--   update public.profiles set persona = 'admin', access_status = 'verified'
--    where user_id = auth.uid() returning persona, access_status;
--   -- BEFORE this migration: admin | verified   (the hole)
--   -- AFTER:                 individual | pending (silently kept)
--   reset role;
--   -- An RPC-like write (postgres, but a non-admin JWT) to a staff row:
--   update public.profiles set persona = 'admin', access_status = 'verified'
--    where user_id = auth.uid();
--   -- AFTER: ERROR 42501 "Only a verified admin can grant or verify a staff profile"
--   rollback;
-- Static checks after applying:
--   select tablename, policyname, qual from pg_policies
--    where policyname in ('admin_view_all_docs','admin_read_all_payments',
--      'admin_update_payments','admin_update_rfps','admin_update_consultations',
--      'admin_update_marina_projects');                        -- is_moderator()
--   select prosecdef from pg_proc
--    where oid = 'public.prevent_profile_privilege_escalation()'::regprocedure; -- false
--   select pg_get_triggerdef(oid) from pg_trigger
--    where tgname = 'trg_prevent_profile_privilege_escalation'; -- BEFORE INSERT OR UPDATE
--   select has_function_privilege('authenticated',
--     'public.compute_pulse_snapshot()', 'EXECUTE');            -- false
-- Exposure re-check, right after applying (accounts verified between 7 Oct and
-- the apply date are not covered by the figures above). Both must return 0 rows;
-- any row is a profile M3 must confirm it approved, else set it back to
-- 'pending' in Admin > Users.
--   -- E1: verified, non-staff, no legitimate verification path
--   select p.user_id, p.persona, p.created_at, p.updated_at
--     from public.profiles p join auth.users u on u.id = p.user_id
--    where p.access_status = 'verified' and p.persona not in ('admin', 'moderator')
--      and not exists (select 1 from public.organization_members m       -- claim, invite,
--             join public.organizations o on o.id = m.organization_id    -- join, admin add,
--            where m.user_id = p.user_id and o.access_status = 'verified') -- payment-ipn
--      and not exists (select 1 from public.organization_invitations i
--            where lower(i.email) = lower(u.email) and i.status = 'accepted')
--      and not exists (select 1 from public.sm_registration r            -- sm26-provision
--            where r.user_id = p.user_id and r.status = 'confirmed')
--      and not exists (select 1 from public.sm_attendee a                -- sm26-attendee-invite
--             join public.sm_registration r on r.id = a.registration_id
--            where a.user_id = p.user_id and r.status = 'confirmed')
--      and not exists (select 1 from public.sp_sponsor_user s where s.user_id = p.user_id);
--   -- E2: verified, non-staff, persona from no sign-up, organization or SM26 source
--   select p.user_id, p.persona, u.raw_user_meta_data->>'persona' as signup_persona
--     from public.profiles p join auth.users u on u.id = p.user_id
--    where p.access_status = 'verified' and p.persona not in ('admin', 'moderator')
--      and p.persona::text is distinct from (u.raw_user_meta_data->>'persona')
--      and not exists (select 1 from public.organization_members m
--             join public.organizations o on o.id = m.organization_id
--            where m.user_id = p.user_id and o.organization_type::text = p.persona::text)
--      and not exists (select 1 from public.sm_registration r
--            where r.user_id = p.user_id and r.status = 'confirmed');
--   -- Staff: select email from public.profiles where persona in ('admin','moderator');
--   --        expect only the known @m3monaco.com team.
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO (each part independently; parts 1-3 re-open holes, part 4 re-opens the
-- self-service admin PATCH: do not undo part 4 without another guard)
-- ════════════════════════════════════════════════════════════════════════════
--   -- Part 1 (repeat for the six policy/table pairs listed above):
--   ALTER POLICY admin_view_all_docs ON public.organization_documents
--     USING (EXISTS (SELECT 1 FROM public.profiles
--             WHERE profiles.user_id = auth.uid()
--               AND profiles.persona = ANY (ARRAY['admin'::public.persona_enum,
--                                                 'moderator'::public.persona_enum])));
--   -- Part 2: restore the previous body:
--   --   DECLARE caller_persona TEXT;
--   --   SELECT persona INTO caller_persona FROM profiles WHERE user_id = auth.uid();
--   --   IF caller_persona NOT IN ('admin', 'moderator') THEN
--   --     RAISE EXCEPTION 'Only admins can refresh the pulse snapshot';
--   --   END IF;
--   -- Part 3:
--   GRANT EXECUTE ON FUNCTION public.compute_pulse_snapshot() TO authenticated;
--   -- Part 4: back to BEFORE UPDATE only and the previous SECURITY DEFINER body:
--   CREATE OR REPLACE TRIGGER trg_prevent_profile_privilege_escalation
--     BEFORE UPDATE ON public.profiles
--     FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();
--   CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
--    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
--   AS $f$
--   BEGIN
--     IF current_user = 'authenticated' AND auth.uid() = OLD.user_id AND NOT public.is_admin() THEN
--       NEW.persona := OLD.persona;
--       NEW.access_status := OLD.access_status;
--     END IF;
--     RETURN NEW;
--   END;
--   $f$;
--
-- Idempotent: ALTER POLICY, CREATE OR REPLACE FUNCTION / TRIGGER and REVOKE can be
-- re-run. CREATE OR REPLACE FUNCTION keeps owner (postgres), ACL and OID.
-- refresh_pulse_snapshot keeps its signature, return type, SECURITY DEFINER and
-- search_path. prevent_profile_privilege_escalation keeps signature and
-- search_path ''; SECURITY DEFINER -> SECURITY INVOKER is the deliberate fix.


-- ─── PART 1: six policies -> verified staff via is_moderator() ──────────────────
-- Was, for all six: EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid()
--   AND profiles.persona = ANY (ARRAY['admin','moderator']))
ALTER POLICY admin_view_all_docs ON public.organization_documents
  USING ((SELECT public.is_moderator()));

ALTER POLICY admin_read_all_payments ON public.payments
  USING ((SELECT public.is_moderator()));

ALTER POLICY admin_update_payments ON public.payments
  USING ((SELECT public.is_moderator()));

ALTER POLICY admin_update_rfps ON public.rfps
  USING ((SELECT public.is_moderator()));

ALTER POLICY admin_update_consultations ON public.consultations
  USING ((SELECT public.is_moderator()));

ALTER POLICY admin_update_marina_projects ON public.marina_projects
  USING ((SELECT public.is_moderator()));


-- ─── PART 2: refresh_pulse_snapshot -> verified staff, no NULL bypass ───────────
CREATE OR REPLACE FUNCTION public.refresh_pulse_snapshot()
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Caller must be a VERIFIED admin or moderator. (The old persona-only test also
  -- let through any caller without a profile: NULL NOT IN (...) is not true.)
  IF NOT public.is_moderator() THEN
    RAISE EXCEPTION 'Only admins can refresh the pulse snapshot';
  END IF;

  INSERT INTO public.pulse_snapshots (snapshot_date, snapshot_data)
  VALUES (CURRENT_DATE, public.compute_pulse_snapshot())
  ON CONFLICT (snapshot_date) DO UPDATE
    SET snapshot_data = EXCLUDED.snapshot_data,
        generated_at  = now();

  RETURN CURRENT_DATE;
END;
$function$;


-- ─── PART 3: compute_pulse_snapshot is internal (owner, cron, refresh only) ─────
REVOKE EXECUTE ON FUNCTION public.compute_pulse_snapshot() FROM PUBLIC, anon, authenticated;


-- ─── PART 4: profile guard trigger, working and extended ────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  -- SECURITY INVOKER on purpose: current_user is the role doing the write.
  -- 'authenticated'/'anon' = a direct PostgREST write by a user;
  -- postgres = inside a SECURITY DEFINER RPC (claim_organization,
  -- accept_org_invitation, handle_new_user, ...) or a migration/SQL editor/cron;
  -- 'service_role' = an edge function on the service key.
  v_api_write boolean := current_user IN ('authenticated', 'anon');
  v_becoming  boolean := false;
  v_jwt_role  text;
  v_trusted   boolean;
BEGIN
  -- 1. Self-freeze: a user's own direct API write cannot change persona or
  --    access_status (kept silently, as this trigger always intended), unless the
  --    user is a verified admin. Trusted server code (RPCs, service role) may.
  IF v_api_write AND NOT public.is_admin() THEN
    IF TG_OP = 'UPDATE' THEN
      IF auth.uid() = OLD.user_id THEN
        NEW.persona       := OLD.persona;
        NEW.access_status := OLD.access_status;
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      NEW.access_status := 'pending';
    END IF;
  END IF;

  -- 2. Staff guard: a row becomes staff, or a staff row becomes verified, only
  --    by the service role, a verified admin, or a session with no API JWT.
  IF NEW.persona IN ('admin', 'moderator') THEN
    IF TG_OP = 'INSERT' THEN
      v_becoming := true;
    ELSE
      v_becoming := OLD.persona IS DISTINCT FROM NEW.persona
                 OR (NEW.access_status = 'verified'
                     AND OLD.access_status IS DISTINCT FROM NEW.access_status);
    END IF;

    IF v_becoming THEN
      v_jwt_role := auth.role();
      v_trusted  := current_user = 'service_role'
                 OR v_jwt_role = 'service_role'
                 OR public.is_admin()
                 OR (v_jwt_role IS NULL AND auth.uid() IS NULL AND NOT v_api_write);
      IF NOT coalesce(v_trusted, false) THEN
        RAISE EXCEPTION 'Only a verified admin can grant or verify a staff profile'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();
