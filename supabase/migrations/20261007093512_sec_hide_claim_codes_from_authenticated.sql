-- Organisation claim codes: hidden from signed-in users, staff RPCs to read and
-- set them, and a throttle on claim_organization.
-- Audit item S2 (Phase 0, security). Second half of the 29 July fix
-- (20260729172344 sec_hide_claim_codes_from_anon + 20260729172419 ..._column_grants).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- * public.organizations.claim_code is readable by EVERY signed-in account.
--   authenticated holds a table-level GRANT SELECT on organizations
--   (relacl authenticated=arwdDxtm/postgres) and policy org_select_auth is
--   USING (true), so
--       GET /rest/v1/organizations?select=name,claim_code&claim_code=not.is.null
--   returns all 168 codes to any account. The July fix closed this for anon only.
-- * claim_organization(code) makes the caller the OWNER of an organization that
--   has none, and verifies the caller's profile when the organization is
--   verified. 164 verified marinas have a code and no owner (6 Oct 2026). Two
--   REST calls = takeover of a real marina brand; the real manager can then only
--   join as a collaborator.
-- * org_claim_attempt was created on 29 July for a throttle that was never wired.
--   claim_organization has no attempt limit at all.
-- * Hiding the column is not enough: INSERT is a second way to test codes.
--   authenticated holds a table-level INSERT on organizations, policy org_insert
--   only checks created_by_user_id = owner_user_id = auth.uid(), there is no
--   BEFORE INSERT trigger, and claim_code is UNIQUE (organizations_claim_code_key).
--   So one POST /rest/v1/organizations with hundreds of rows, each with a
--   guessed claim_code and a tier that does not exist, answers 409/23505 on
--   organizations_claim_code_key if one guess is live, or 23503 (tier foreign
--   key, checked at end of statement, nothing stored) if none is. That needs no
--   SELECT on the column and writes nothing to org_claim_attempt; then one
--   claim_organization call with the right code (0 failures) takes the marina.
--   The same grant also lets any account insert its own organization with
--   access_status = 'verified', tier = 'main_sponsor', featured_partner = true:
--   the guard trigger is BEFORE UPDATE only.
--   UPDATE is not an oracle: guard_org_sensitive_columns resets claim_code to its
--   old value for every API caller that is not a verified moderator/admin.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration changes (4 parts)
-- ════════════════════════════════════════════════════════════════════════════
-- PART 1. Privileges for anon / authenticated (SELECT on claim_code, INSERT).
--   A column-level REVOKE does nothing while a table-level GRANT SELECT exists
--   (that is exactly what went wrong on 29 July for anon). So: REVOKE the
--   table-level SELECT from authenticated, then GRANT SELECT on every column
--   except claim_code. The column list is read from the catalog at apply time,
--   so it is the exact current set (33 columns on 6 Oct 2026, identical to the
--   anon list of 20260729172419); the assertions at the end abort the migration
--   if any other column lost SELECT or if claim_code is still readable.
--   anon is only checked (it already has no access to claim_code).
--   Filtering or ordering on claim_code (?claim_code=eq.X, ilike, order=, WHERE
--   in an UPDATE) needs SELECT on the column, so it is closed too.
--   INSERT: the table-level INSERT is revoked from anon and authenticated (no
--   column re-grant), which closes the unique-constraint oracle above. Nothing
--   legitimate inserts into organizations as anon/authenticated (checked 6 Oct
--   2026):
--     - src/: no .from('organizations').insert / .upsert anywhere; org creation
--       goes through the create_organization RPC (SECURITY DEFINER, postgres).
--     - SQL: every function that inserts into organizations is create_organization
--       (SECURITY DEFINER); the only SECURITY INVOKER function reading it,
--       apply_ops_commercial_event, is executable by service_role only and does
--       not insert into it.
--     - Edge functions: the only insert is sm26-provision, with service_role.
--     - pg_stat_statements: every recorded PostgREST INSERT INTO organizations
--       ran as service_role (58 calls), none as authenticated or anon.
--   anon already could not insert (no INSERT policy for anon), the revoke is
--   defence in depth. service_role and postgres keep INSERT.
--   UPDATE / DELETE grants are untouched: guard_org_sensitive_columns
--   (BEFORE UPDATE) pins claim_code for every API write that is not a verified
--   moderator/admin, so an UPDATE never trips the unique constraint.
--   org_claim_attempt: RLS is on with no policy (default deny); its grants to
--   anon/authenticated are revoked too (TRUNCATE is not subject to RLS). Only the
--   SECURITY DEFINER claim_organization writes it.
--
-- PART 2. Staff RPCs (SECURITY DEFINER, is_admin()):
--     admin_get_org_claim_code(p_org_id uuid) returns text
--     admin_set_org_claim_code(p_org_id uuid, p_claim_code text) returns text
--   is_admin() because the only screen that shows or edits the code, the admin
--   organisation sheet (/admin/organizations/:id, AdminOrganizationDetail), sits
--   behind AdminOnlyGuard (verified admin), not the moderator guard.
--   The set RPC trims + upper-cases (the editor already upper-cases, and
--   claim_organization compares upper(trim())), refuses a code another
--   organization already uses in any case (claim_organization matches
--   case-insensitively, so two codes differing only by case would be ambiguous),
--   and writes an organization_audit_log row WITHOUT the code itself.
--   "Send Connect Link" sends the code returned by admin_get_org_claim_code.
--
-- PART 3. claim_organization(text): throttle. Same signature, owner, SECURITY
--   DEFINER, search_path, grants; the success path and every error message are
--   unchanged.
--   * At most 10 FAILED codes per user per rolling hour (rows in
--     org_claim_attempt). The 11th call is refused, even with a correct code,
--     with 'Too many attempts. Please wait an hour and try again.'
--   * A per-user transaction advisory lock serialises one user's parallel calls,
--     so a burst of concurrent requests cannot all pass the count.
--   * The trap: a RAISE rolls the whole transaction back, including the INSERT of
--     the failed attempt, so a RAISE-based throttle records nothing (this is why
--     sm_claim_registration returns NULL instead of raising). Here, for a call
--     that comes through PostgREST (request.method / request.headers are set;
--     sm_vote_ip_hash already relies on request.headers here), an invalid code
--     records the attempt and RETURNS the exact body PostgREST builds for a
--     RAISE -- {"code":"P0001","message":"Invalid organization code",
--     "details":null,"hint":null} -- with HTTP 400 via the response.status GUC.
--     PostgREST commits a transaction that did not fail, whatever the status
--     set by the function. supabase-js then gives the caller exactly what it got
--     before: data = null, error = { code: 'P0001', message: 'Invalid
--     organization code', ... }. Callers checked: src/pages/OnboardingPage.tsx
--     (auto-claim from ?code / pending_claim_code, and the manual "claim" button);
--     both do `if (error) throw error` and never read data on error.
--     Outside PostgREST (SQL console, another SQL function) it still RAISEs
--     'Invalid organization code', exactly as before (nothing to commit then).
--   * Old rows of the caller (> 1 day) are deleted on each failure, so the table
--     stays tiny.
--   Not covered: claim_organization_for_user(uuid,text) (service_role only, used
--   by the claim-code-signup edge function, whose code lookup is the public
--   oracle) -- see the hand-off notes.
--
-- PART 4. Codes are NOT rotated (decision D9).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Deploy order (important)
-- ════════════════════════════════════════════════════════════════════════════
--   1. Deploy the frontend that no longer reads organizations with select('*')
--      (AuthContext, OrganizationTab, OrganizationPublicPage,
--      AdminOrganizationDetail, AdminUserDetail) and calls the two staff RPCs.
--      That build works before AND after this migration (the RPC calls fail
--      softly before it: the claim-code editor is disabled, never blanked).
--   2. Then apply this migration. After it, `select=*` on organizations by a
--      signed-in user fails with 42501 "permission denied for table
--      organizations" (already the case for anon since 29 July). The old
--      AuthContext used select('*'): applied first, every signed-in user would
--      lose their company until the new build is loaded.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Trap for future migrations
-- ════════════════════════════════════════════════════════════════════════════
--   A column added to public.organizations is NOT readable by anon or
--   authenticated until it is granted explicitly:
--       grant select (new_column) on public.organizations to anon, authenticated;
--   And never read organizations with select('*') / select=* from the client.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Verify after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select has_column_privilege('authenticated','public.organizations','claim_code','SELECT'); -- false
--   select has_column_privilege('authenticated','public.organizations','name','SELECT');       -- true
--   select has_any_column_privilege('authenticated','public.organizations','INSERT');         -- false
--   select has_table_privilege('service_role','public.organizations','INSERT');               -- true
--   Then, signed in as a NON-admin test account in the app, enter a wrong code on
--   /onboarding: the toast is unchanged ("Invalid organization code") and
--     select count(*) from public.org_claim_attempt;   -- grew by 1
--   (if it did not grow, PostgREST rolled back: tell the author).
--   Admin sheet /admin/organizations/<id of an org with a code>: the code shows,
--   can be changed and saved, "Send" is enabled.
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO
-- ════════════════════════════════════════════════════════════════════════════
--   grant select on public.organizations to authenticated;  -- table-level again (covers claim_code)
--   grant insert on public.organizations to anon, authenticated; -- previous INSERT grants (reopens the oracle)
--   grant all on public.org_claim_attempt to anon, authenticated; -- previous grants (arwdDxtm)
--   drop function if exists public.admin_get_org_claim_code(uuid);
--   drop function if exists public.admin_set_org_claim_code(uuid, text);
--   -- claim_organization without the throttle: re-run the claim_organization
--   -- block of 20260722154912 claim_promotes_member_and_admin_set_org_owner
--   -- (supabase_migrations.schema_migrations), unchanged until this migration.
--   -- Do NOT undo the frontend: it works with either grant set.
--
-- Idempotent: the DO blocks, CREATE OR REPLACE FUNCTION and REVOKE/GRANT can be
-- re-run. CREATE OR REPLACE keeps owner (postgres), ACL and OID.

-- ─── PART 1. Privileges (SELECT on claim_code, INSERT) ──────────────────────
do $$
declare
  v_cols text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.organizations'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname <> 'claim_code';

  if v_cols is null then
    raise exception 'S2: no column found on public.organizations';
  end if;

  -- A table-level REVOKE also removes any column-level SELECT grants, so the
  -- re-grant below leaves exactly "every column but claim_code".
  execute 'revoke select on public.organizations from authenticated';
  execute format('grant select (%s) on public.organizations to authenticated', v_cols);
end
$$;

-- INSERT: closes the UNIQUE(claim_code) oracle (see "Why"). A table-level
-- REVOKE also removes any column-level INSERT grants.
revoke insert on public.organizations from anon, authenticated;

revoke all on public.org_claim_attempt from anon, authenticated;

-- ─── PART 1b. Claim code format (all 168 codes already match; checked 7 Oct) ──
-- claim-code-signup looks codes up by exact match and only accepts this shape,
-- so a code saved in any other form could never be used through the sign-up link.
alter table public.organizations drop constraint if exists organizations_claim_code_format;
alter table public.organizations add constraint organizations_claim_code_format
  check (claim_code is null or claim_code ~ '^[A-Z0-9][A-Z0-9-]{1,63}$');

-- ─── PART 2. Staff RPCs ──────────────────────────────────────────────────────
create or replace function public.admin_get_org_claim_code(p_org_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_code text;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_org_id is null then raise exception 'Missing identifier'; end if;

  select claim_code into v_code from organizations where id = p_org_id;
  if not found then raise exception 'Organization not found'; end if;

  return v_code;
end;
$function$;

revoke all on function public.admin_get_org_claim_code(uuid) from public, anon;
grant execute on function public.admin_get_org_claim_code(uuid) to authenticated;

create or replace function public.admin_set_org_claim_code(p_org_id uuid, p_claim_code text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old text;
  v_new text;
begin
  if not is_admin() then raise exception 'Not authorized'; end if;
  if p_org_id is null then raise exception 'Missing identifier'; end if;

  v_new := nullif(upper(btrim(coalesce(p_claim_code, ''))), '');
  if v_new is not null and v_new !~ '^[A-Z0-9][A-Z0-9-]{1,63}$' then
    -- claim-code-signup only accepts this shape (exact lookup, no patterns).
    raise exception 'Claim code: letters, digits and dashes only (2 to 64 characters)';
  end if;

  select claim_code into v_old from organizations where id = p_org_id for update;
  if not found then raise exception 'Organization not found'; end if;

  if v_new is not distinct from v_old then
    return v_old;
  end if;

  if v_new is not null and exists (
    select 1 from organizations
     where id <> p_org_id
       and claim_code is not null
       and upper(btrim(claim_code)) = v_new
  ) then
    raise exception 'This claim code is already used by another organization';
  end if;

  -- Runs as postgres: guard_org_sensitive_columns lets SECURITY DEFINER
  -- contexts through (current_user <> 'authenticated').
  update organizations
     set claim_code = v_new, updated_at = now()
   where id = p_org_id;

  -- Audit without the code itself (organization_audit_log is readable by the
  -- organization's owner).
  perform log_org_event(
    p_org_id,
    case when v_new is null then 'claim_code_cleared_by_admin' else 'claim_code_set_by_admin' end,
    jsonb_build_object(
      'by_user_id', coalesce(auth.uid()::text, ''),
      'had_code', v_old is not null
    )
  );

  return v_new;
end;
$function$;

revoke all on function public.admin_set_org_claim_code(uuid, text) from public, anon;
grant execute on function public.admin_set_org_claim_code(uuid, text) to authenticated;

-- ─── PART 3. claim_organization with a throttle ──────────────────────────────
-- Everything from "select exists(... v_has_owner" down is the 20260722154912
-- body, unchanged.
create or replace function public.claim_organization(p_claim_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org record;
  v_user_id uuid;
  v_existing boolean;
  v_has_owner boolean;
  v_role text;
  v_fails int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  -- Throttle (audit S2): at most 10 failed codes per user per rolling hour.
  -- The lock serialises this user's concurrent calls until commit, so each one
  -- counts the failures the previous ones recorded.
  perform pg_advisory_xact_lock(hashtextextended('org_claim_attempt:' || v_user_id::text, 0));
  select count(*) into v_fails
    from org_claim_attempt
   where user_id = v_user_id
     and attempted_at > now() - interval '1 hour';
  if v_fails >= 10 then
    raise exception 'Too many attempts. Please wait an hour and try again.';
  end if;

  select id, name, access_status, organization_type into v_org
  from organizations
  where upper(trim(claim_code)) = upper(trim(p_claim_code)) and claim_code is not null;
  if not found then
    if coalesce(current_setting('request.method', true), '') = ''
       and coalesce(current_setting('request.headers', true), '') = '' then
      -- Not an API request: keep the historical contract (a RAISE). Nothing
      -- could be recorded anyway, the RAISE rolls the transaction back.
      raise exception 'Invalid organization code';
    end if;
    -- API request: record the failure and answer exactly what PostgREST sends
    -- for a RAISE (HTTP 400, same JSON error body), without rolling back.
    insert into org_claim_attempt (user_id) values (v_user_id);
    delete from org_claim_attempt
     where user_id = v_user_id
       and attempted_at < now() - interval '1 day';
    perform set_config('response.status', '400', true);
    return jsonb_build_object(
      'code', 'P0001',
      'message', 'Invalid organization code',
      'details', null,
      'hint', null
    );
  end if;

  select exists(select 1 from organization_members
                where organization_id = v_org.id and role = 'owner') into v_has_owner;
  select exists(select 1 from organization_members
                where user_id = v_user_id and organization_id = v_org.id) into v_existing;

  if v_existing then
    -- Already a member. Only a genuine no-op deserves an error: if somebody
    -- already owns this organization there is nothing left to claim.
    if v_has_owner then
      raise exception 'You are already a member of this organization';
    end if;
    update organization_members set role = 'owner'
      where organization_id = v_org.id and user_id = v_user_id;
    v_role := 'owner';
  else
    v_role := case when v_has_owner then 'collaborator' else 'owner' end;
    insert into organization_members (user_id, organization_id, role)
    values (v_user_id, v_org.id, v_role);
  end if;

  -- Owner of record (fixes the null owner_user_id -> broken connect flow).
  if v_role = 'owner' then
    update organizations set owner_user_id = v_user_id
    where id = v_org.id and owner_user_id is null;
  end if;

  if v_org.access_status = 'verified' then
    update profiles
    set access_status = 'verified', onboarding_status = 'completed',
        persona = v_org.organization_type::persona_enum, updated_at = now()
    where user_id = v_user_id;
  end if;

  return jsonb_build_object('organization_id', v_org.id,
                            'organization_name', v_org.name, 'role', v_role);
end;
$function$;

-- ─── Assertions (abort the migration if the grants are not what we expect) ──
do $$
declare
  v_missing text;
begin
  if has_column_privilege('authenticated', 'public.organizations', 'claim_code', 'SELECT') then
    raise exception 'S2: authenticated can still read organizations.claim_code';
  end if;
  if has_column_privilege('anon', 'public.organizations', 'claim_code', 'SELECT') then
    raise exception 'S2: anon can read organizations.claim_code';
  end if;

  select string_agg(a.attname, ', ' order by a.attnum)
    into v_missing
    from pg_attribute a
   where a.attrelid = 'public.organizations'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname <> 'claim_code'
     and not has_column_privilege('authenticated', 'public.organizations', a.attname, 'SELECT');
  if v_missing is not null then
    raise exception 'S2: authenticated lost SELECT on organizations columns: %', v_missing;
  end if;

  if not has_column_privilege('service_role', 'public.organizations', 'claim_code', 'SELECT') then
    raise exception 'S2: service_role must keep reading claim_code (claim-code-signup)';
  end if;

  if has_any_column_privilege('authenticated', 'public.organizations', 'INSERT') then
    raise exception 'S2: authenticated can still insert into organizations (claim_code oracle)';
  end if;
  if has_any_column_privilege('anon', 'public.organizations', 'INSERT') then
    raise exception 'S2: anon can still insert into organizations';
  end if;
  if not has_table_privilege('service_role', 'public.organizations', 'INSERT') then
    raise exception 'S2: service_role must keep INSERT on organizations (sm26-provision)';
  end if;
end
$$;

notify pgrst, 'reload schema';
