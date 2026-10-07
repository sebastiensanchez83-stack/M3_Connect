-- RFPs and consultations: only M3 staff decide the moderation columns.
-- Hotfix, 7 Oct 2026 (follow-up of 20261007211600_developers_publish_needs).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- The owner policies rfps_write_owner / consultations_write_owner (verified
-- marinas) and, since 20261007211600, rfps_write_owner_developer /
-- consultations_write_owner_developer (verified developers) are FOR ALL with no
-- column restriction. What the database said on 7 Oct 2026 (read-only):
--   - authenticated holds INSERT and UPDATE on rfps and consultations columns
--     status, admin_notes and rejection_reason (has_column_privilege /
--     information_schema.column_privileges);
--   - the only triggers on both tables are trg_rfps_updated_at /
--     trg_consultations_updated_at (set_updated_at).
-- So an owner could insert or PATCH their own RFP or consultation straight
-- through PostgREST with status = 'approved' (and write admin_notes /
-- rejection_reason), skipping M3 moderation: OpportunitiesPage and DashboardPage
-- list every status = 'approved' row to the marketplace.
--
-- A column-level REVOKE is not an option: staff (AdminRFPDetail.tsx:100,
-- AdminConsultationDetail.tsx:105) update status / admin_notes /
-- rejection_reason through the same authenticated role (policies
-- admin_update_rfps / admin_update_consultations, is_moderator()).
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration does
-- ════════════════════════════════════════════════════════════════════════════
-- One trigger function, public.guard_need_moderation_columns(), fired BEFORE
-- INSERT OR UPDATE on public.rfps and public.consultations. For a direct API
-- write (current_user 'authenticated' or 'anon') by someone who is NOT verified
-- staff (public.is_moderator() = is_verified('admin') OR is_verified('moderator')):
--   INSERT: status := 'submitted' (the column default), admin_notes := NULL,
--           rejection_reason := NULL.
--   UPDATE: status, admin_notes and rejection_reason keep their OLD values.
-- Silently, like prevent_profile_privilege_escalation and
-- guard_org_sensitive_columns: no screen of the owner writes these columns, so
-- nothing legitimate is refused.
-- SECURITY INVOKER on purpose (see 20261007081437): current_user must be the
-- role doing the write. postgres (SECURITY DEFINER RPCs, migrations, SQL
-- editor, cron) and service_role (edge functions) are not restricted. No
-- database function or edge function writes these tables today.
--
-- Callers checked (grep of src/ and supabase/functions/):
--   * SubmitRFPPage.tsx:105 / :130 and SubmitConsultationPage.tsx:88 / :104
--     (owner insert + edit): title, scope/description, sector_id, deadline_date,
--     organization_id, is_open. No moderation column: unaffected. A new row
--     still starts 'submitted'.
--   * AccountPage.tsx:1400 / :1470 (owner toggles is_open), :1408 / :1478
--     (owner delete): unaffected.
--   * AdminRFPDetail.tsx:100, AdminConsultationDetail.tsx:105 (staff set status,
--     admin_notes, rejection_reason): is_moderator() is true, unaffected.
--   There is no owner "resubmit" (rejected -> submitted) flow in the UI; an
--   owner edit of a rejected row keeps it rejected, as before.
--
-- Production on 7 Oct 2026: 0 rfps, 0 consultations rows, so no existing row
-- is affected.
--
-- Idempotent: CREATE OR REPLACE FUNCTION / TRIGGER.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select tgrelid::regclass, pg_get_triggerdef(oid) from pg_trigger
--    where tgname in ('trg_rfps_guard_moderation', 'trg_consultations_guard_moderation');
--                                            -- 2 rows, BEFORE INSERT OR UPDATE
--   select prosecdef from pg_proc where proname = 'guard_need_moderation_columns';
--                                            -- false (SECURITY INVOKER)
--   -- Proof inside a rolled-back transaction (SQL editor, as postgres):
--   begin;
--   select set_config('request.jwt.claims',
--     (select json_build_object('sub', user_id, 'role', 'authenticated')::text
--        from public.profiles where persona = 'developer' and access_status = 'verified'
--        limit 1), true);
--   set local role authenticated;
--   insert into public.rfps (marina_user_id, title, scope, status, admin_notes)
--     values (auth.uid(), 'test', 'test', 'approved', 'x')
--     returning status, admin_notes;              -- submitted, null
--   update public.rfps set status = 'approved', rejection_reason = 'x'
--    where marina_user_id = auth.uid()
--    returning status, rejection_reason;           -- submitted, null
--   rollback;
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO (reopens self-approval for every owner)
-- ════════════════════════════════════════════════════════════════════════════
--   DROP TRIGGER IF EXISTS trg_rfps_guard_moderation ON public.rfps;
--   DROP TRIGGER IF EXISTS trg_consultations_guard_moderation ON public.consultations;
--   DROP FUNCTION IF EXISTS public.guard_need_moderation_columns();

CREATE OR REPLACE FUNCTION public.guard_need_moderation_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
BEGIN
  -- SECURITY INVOKER on purpose: current_user is the role doing the write.
  -- 'authenticated'/'anon' = a direct PostgREST write by a user; postgres (RPCs,
  -- migrations, cron) and service_role (edge functions) pass untouched.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  -- Verified staff moderate: they may set anything.
  IF public.is_moderator() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status           := 'submitted';
    NEW.admin_notes      := NULL;
    NEW.rejection_reason := NULL;
  ELSE
    NEW.status           := OLD.status;
    NEW.admin_notes      := OLD.admin_notes;
    NEW.rejection_reason := OLD.rejection_reason;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.guard_need_moderation_columns() IS
  'BEFORE INSERT OR UPDATE on rfps and consultations: a direct API write by a non-staff user cannot set status, admin_notes or rejection_reason (INSERT starts submitted, UPDATE keeps the old values). SECURITY INVOKER on purpose. Hotfix 2026-10-07.';

CREATE OR REPLACE TRIGGER trg_rfps_guard_moderation
  BEFORE INSERT OR UPDATE ON public.rfps
  FOR EACH ROW EXECUTE FUNCTION public.guard_need_moderation_columns();

CREATE OR REPLACE TRIGGER trg_consultations_guard_moderation
  BEFORE INSERT OR UPDATE ON public.consultations
  FOR EACH ROW EXECUTE FUNCTION public.guard_need_moderation_columns();
