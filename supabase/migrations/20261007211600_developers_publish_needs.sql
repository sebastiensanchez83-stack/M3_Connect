-- Verified developers may publish needs (RFPs, consultations) exactly like
-- verified marinas. Hotfix, 7 Oct 2026.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- Rights per company type validated by Victor on 6 Oct 2026: "Developer —
-- publish needs (RFP / consultations / projects): yes; see opportunities: yes".
-- Asked on 7 Oct whether to align the database, he answered "Oui, ouvrir la base".
-- The submit pages already let a developer through (SubmitRFPPage,
-- SubmitConsultationPage, SubmitProjectPage test persona 'marina' OR 'developer'),
-- but the database refused the write.
--
-- What the database said on 7 Oct 2026 (pg_policies, read-only):
--   rfps.rfps_write_owner                      ALL     TO authenticated
--     USING / WITH CHECK ((marina_user_id = (SELECT auth.uid())) AND is_verified('marina'))
--   consultations.consultations_write_owner    ALL     TO authenticated
--     USING / WITH CHECK ((marina_user_id = (SELECT auth.uid())) AND is_verified('marina'))
--   rfps.rfps_select_marketplace               SELECT  TO authenticated
--     USING (is_moderator() OR marina_user_id = (SELECT auth.uid()) OR has_marketplace_access())
--   consultations.consultations_select_marketplace  (same as rfps)
--   rfps.admin_update_rfps / consultations.admin_update_consultations
--     UPDATE TO public USING ((SELECT is_moderator()))      -- staff, unchanged
--   has_marketplace_access() = is_moderator() OR verified persona in
--     ('marina','partner','media_partner') OR is_partner_like()  -- no 'developer'
--   marina_projects: marina_projects_insert (INSERT, WITH CHECK user_id = auth.uid()),
--     marina_projects_select / update_own_or_moderator (own row or is_moderator()),
--     delete_own (own row), admin_update_marina_projects (is_moderator()).
--     -> no persona restriction at all: developers can already submit projects.
--     Nothing changed on marina_projects.
--   No trigger restricts persona on the three tables (only set_updated_at on rfps
--   and consultations). No database function writes to them. rfp_sectors'
--   insert policy checks only that the caller owns the RFP. No storage policy
--   mentions them.
--
-- So for a verified marina the database allows, on rfps and consultations:
--   (a) insert / update / delete / read its own rows (rfps_write_owner, ALL), and
--   (b) read every row (has_marketplace_access() in *_select_marketplace).
-- A verified developer had only "read own rows" through the select policy.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration does (additive: new permissive policies, nothing altered)
-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 (publish): rfps_write_owner_developer, consultations_write_owner_developer
--   = the marina owner policies with is_verified('developer') instead of
--   is_verified('marina'). Same command (ALL), role (authenticated), owner column
--   and USING = WITH CHECK. Permissive policies are OR-ed, so marinas are
--   unaffected.
-- PART 2 (see opportunities, parity with marinas on these two tables):
--   rfps_select_developer, consultations_select_developer = read every row for a
--   verified developer, i.e. what has_marketplace_access() gives a verified marina
--   here. has_marketplace_access() itself is NOT changed: it also drives
--   partners.partners_select_directory, which is out of scope.
--
-- Conditions are the marina's, unchanged: VERIFIED profile with persona
-- 'developer' (is_verified() reads profiles.access_status; a profile cannot
-- change its own persona/access_status since 20261007081437). Like for
-- marinas, the database does not check organizations.access_status (the pages
-- do) and the owner policy lets the owner write any column of its own row,
-- including the moderation columns (status, admin_notes, rejection_reason):
-- that hole, shared by marinas, is closed for both personas by the next
-- migration, 20261007212000_needs_moderation_guard (apply them together).
--
-- Production on 7 Oct 2026: 1 developer profile (verified); 0 rfps, 0
-- consultations, 0 marina_projects rows.
--
-- Client, same commit: src/App.tsx guards /submit-rfp, /submit-consultation and
-- /submit-project (and their /:id edit routes) with
-- requirePersona={['marina', 'developer']} (it was ['marina'], which showed the
-- locked screen to developers).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select tablename, policyname, cmd, roles, qual, with_check from pg_policies
--    where schemaname = 'public' and tablename in ('rfps', 'consultations')
--    order by tablename, policyname;    -- 4 new rows with is_verified('developer')
--   -- Proof inside a rolled-back transaction (SQL editor, as postgres):
--   begin;
--   select set_config('request.jwt.claims',
--     (select json_build_object('sub', user_id, 'role', 'authenticated')::text
--        from public.profiles where persona = 'developer' and access_status = 'verified'
--        limit 1), true);
--   set local role authenticated;
--   insert into public.rfps (marina_user_id, title, scope)
--     values (auth.uid(), 'test', 'test') returning id;            -- 1 row (was: RLS error)
--   insert into public.consultations (marina_user_id, title, description)
--     values (auth.uid(), 'test', 'test') returning id;            -- 1 row (was: RLS error)
--   rollback;
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO
-- ════════════════════════════════════════════════════════════════════════════
--   DROP POLICY IF EXISTS rfps_write_owner_developer ON public.rfps;
--   DROP POLICY IF EXISTS consultations_write_owner_developer ON public.consultations;
--   DROP POLICY IF EXISTS rfps_select_developer ON public.rfps;
--   DROP POLICY IF EXISTS consultations_select_developer ON public.consultations;


-- ─── PART 1: verified developers write their own needs ─────────────────────────
DROP POLICY IF EXISTS rfps_write_owner_developer ON public.rfps;
CREATE POLICY rfps_write_owner_developer ON public.rfps
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((marina_user_id = (SELECT auth.uid())) AND public.is_verified('developer'::public.persona_enum))
  WITH CHECK ((marina_user_id = (SELECT auth.uid())) AND public.is_verified('developer'::public.persona_enum));

DROP POLICY IF EXISTS consultations_write_owner_developer ON public.consultations;
CREATE POLICY consultations_write_owner_developer ON public.consultations
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((marina_user_id = (SELECT auth.uid())) AND public.is_verified('developer'::public.persona_enum))
  WITH CHECK ((marina_user_id = (SELECT auth.uid())) AND public.is_verified('developer'::public.persona_enum));


-- ─── PART 2: verified developers see the opportunities, like verified marinas ───
DROP POLICY IF EXISTS rfps_select_developer ON public.rfps;
CREATE POLICY rfps_select_developer ON public.rfps
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT public.is_verified('developer'::public.persona_enum)));

DROP POLICY IF EXISTS consultations_select_developer ON public.consultations;
CREATE POLICY consultations_select_developer ON public.consultations
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT public.is_verified('developer'::public.persona_enum)));
