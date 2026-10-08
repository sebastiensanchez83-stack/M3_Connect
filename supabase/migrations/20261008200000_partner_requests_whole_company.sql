-- A connection request goes to the WHOLE receiving company, and any member can answer it.
-- Victor, 8 Oct 2026: "when someone connects with the company, it should send an e-mail
-- to all the members of the company" / "any member can answer".
--
-- ════════════════════════════════════════════════════════════════════════════
-- What changes
-- ════════════════════════════════════════════════════════════════════════════
--  1. Two new columns on public.partner_requests, written by trigger only:
--       answered_by_user_id  uuid  (profiles.user_id, ON DELETE SET NULL)
--       answered_at          timestamptz
--     Set when the status goes to accepted/rejected (the caller, now()), cleared when
--     the partner re-opens the request (status back to pending), kept otherwise.
--     Whatever a client sends for them is ignored.
--  2. BEFORE INSERT trigger (partner_requests_before_insert):
--       * marina_organization_id := the organisation marina_user_id belongs to. The
--         one the client passes is kept when marina_user_id is a member (or the
--         owner_user_id) of it; otherwise, or when it is null, the pick is
--         deterministic: owner_user_id of the org first, then role 'owner', then the
--         oldest membership, then the id. Null when marina_user_id has no org.
--       * partner_organization_id: same rule for partner_user_id (send-notification
--         and the inbox can then trust it; until now RLS never checked it).
--       * a self-service insert always starts 'pending' (the INSERT policy never
--         checked the status: a requester could insert an "accepted" row).
--     Why the org is checked rather than taken as given: from now on that column grants
--     SELECT and UPDATE to every member of the organisation, so it must be an
--     organisation of the recipient.
--  3. BEFORE UPDATE trigger (partner_requests_before_update), for self-service
--     updates (role authenticated, not a verified moderator/admin):
--       * partner_user_id, marina_user_id, partner_organization_id,
--         marina_organization_id and created_at cannot change (the old policies let
--         either side rewrite them: only the status was ever meant to move).
--       * Recipient side (anyone but partner_user_id): FIRST ANSWER WINS. The status
--         may only go from 'pending' to 'accepted' or 'rejected'; any other change
--         (answering twice, a colleague overriding an answer, back to pending) fails.
--       * The requester cannot answer their own request (accepted/rejected).
--       * Partner side otherwise unchanged (RLS: withdrawn or pending).
--  4. RLS, see "Policies before / after" below: members of marina_organization_id
--     can SELECT the request, and verified members can UPDATE its status.
--  5. Backfill (54 rows on 8 Oct 2026, all with both org ids null): marina_ and
--     partner_organization_id resolved by the same rule (54/54 resolvable, one
--     recipient belongs to two orgs: owner-first pick), and answered_by_user_id /
--     answered_at for the 27 already answered rows = marina_user_id / updated_at
--     (until today only marina_user_id, or a moderator, could answer). updated_at is
--     left untouched (the updated_at trigger is disabled around the backfill), so no
--     old answer looks "answered in the last 15 minutes" to send-notification.
--
-- Old client (still live on main): keeps working unchanged. It inserts without org ids
-- (filled here), reads requests with .or(partner_user_id, marina_user_id) (still
-- visible), answers pending requests as marina_user_id (allowed, records the answer)
-- and never changes any other column. Only a recipient re-answering a request it
-- already answered is now refused; the old inbox only offers buttons on pending rows.
-- Admin consoles (verified moderators/admins) and the service role are not guarded.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Policies before / after
-- ════════════════════════════════════════════════════════════════════════════
--  partner_requests_select (SELECT, authenticated)
--    before: partner_user_id = me OR marina_user_id = me OR is_moderator()
--    after:  ... OR (marina_organization_id IS NOT NULL AND is_org_member(marina_organization_id))
--  partner_requests_update (UPDATE, authenticated)
--    before USING: is_moderator() OR marina_user_id = me OR partner_user_id = me
--    after  USING: ... OR (marina_organization_id IS NOT NULL AND is_org_member(marina_organization_id))
--    before CHECK: is_moderator()
--                  OR (marina_user_id = me AND is_verified() AND status IN (accepted, rejected, pending))
--                  OR (partner_user_id = me AND is_verified() AND status IN (withdrawn, pending))
--    after  CHECK: is_moderator()
--                  OR ((marina_user_id = me OR is_org_member(marina_organization_id))
--                      AND is_verified() AND status IN (accepted, rejected, pending))
--                  OR (partner_user_id = me AND is_verified() AND status IN (withdrawn, pending))
--    (+ the BEFORE UPDATE trigger above: recipient side pending -> accepted/rejected only)
--  partner_requests_insert_verified: unchanged.
--  No DELETE policy, as before.
--
-- Reused helpers (checked 8 Oct 2026): is_org_member(uuid) (SECURITY DEFINER,
-- organization_members of auth.uid()), is_verified(persona_enum) (profile verified),
-- is_moderator() (verified admin or moderator).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select count(*) filter (where marina_organization_id is null) as no_marina_org,
--          count(*) filter (where partner_organization_id is null) as no_partner_org,
--          count(*) filter (where status in ('accepted','rejected') and answered_at is null) as unanswered
--     from public.partner_requests;                       -- expected after: 0, 0, 0
--   select tgname from pg_trigger where tgrelid = 'public.partner_requests'::regclass and not tgisinternal;
--     -> trg_partner_requests_before_insert, trg_partner_requests_before_update,
--        trg_partner_requests_updated_at
--   Proof inside a rolled-back transaction (as a verified colleague of the recipient):
--     begin;
--     set local role authenticated;
--     select set_config('request.jwt.claims', json_build_object('sub','<colleague id>','role','authenticated')::text, true);
--     update public.partner_requests set status = 'accepted' where id = '<pending request of their org>'
--       returning answered_by_user_id, answered_at;          -- the colleague, now()
--     update public.partner_requests set status = 'rejected' where id = '<same id>';
--       -- ERROR: this request has already been answered
--     rollback;
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO
-- ════════════════════════════════════════════════════════════════════════════
--   DROP TRIGGER IF EXISTS trg_partner_requests_before_insert ON public.partner_requests;
--   DROP TRIGGER IF EXISTS trg_partner_requests_before_update ON public.partner_requests;
--   DROP FUNCTION IF EXISTS public.partner_requests_before_insert();
--   DROP FUNCTION IF EXISTS public.partner_requests_before_update();
--   DROP FUNCTION IF EXISTS public.partner_request_user_org(uuid, uuid);
--   then recreate the two "before" policies above (text in this header). The columns
--   (answered_by_user_id, answered_at) and the backfilled org ids can stay.

-- ─── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE public.partner_requests
  ADD COLUMN IF NOT EXISTS answered_by_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS answered_at timestamptz;

COMMENT ON COLUMN public.partner_requests.answered_by_user_id IS
  'Who accepted or declined the request (any member of marina_organization_id, or a moderator). Set by trigger only.';
COMMENT ON COLUMN public.partner_requests.answered_at IS
  'When the request was accepted or declined. Set by trigger only.';

-- ─── 2. Which organisation a user speaks for ───────────────────────────────
-- p_preferred is kept when the user belongs to it (member, or owner_user_id of it);
-- otherwise the deterministic pick described in the header. Null when the user has no
-- organisation. SECURITY INVOKER: organization_members and organizations are readable
-- by every signed-in account (org_members_select_auth, org_select_auth: true).
CREATE OR REPLACE FUNCTION public.partner_request_user_org(p_user_id uuid, p_preferred uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select c.org_id
    from (
      select m.organization_id as org_id,
             (m.role = 'owner') as owner_role,
             m.joined_at
        from public.organization_members m
       where m.user_id = p_user_id
      union all
      select o.id, true, null::timestamptz
        from public.organizations o
       where o.owner_user_id = p_user_id
    ) c
    left join public.organizations org on org.id = c.org_id
   where p_user_id is not null
   order by (c.org_id = p_preferred) desc nulls last,
            (org.owner_user_id = p_user_id) desc nulls last,
            c.owner_role desc,
            c.joined_at asc nulls last,
            c.org_id
   limit 1;
$function$;

COMMENT ON FUNCTION public.partner_request_user_org(uuid, uuid) IS
  'The organisation a user speaks for in a partner request: p_preferred when the user belongs to it, else owner_user_id first, then role owner, then the oldest membership. 2026-10-08.';

REVOKE EXECUTE ON FUNCTION public.partner_request_user_org(uuid, uuid) FROM anon;

-- ─── 3. BEFORE INSERT ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_requests_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Every insert, the service role and staff included: the org ids must be orgs of
  -- the two users, since marina_organization_id grants read and answer rights.
  new.marina_organization_id  := public.partner_request_user_org(new.marina_user_id, new.marina_organization_id);
  new.partner_organization_id := public.partner_request_user_org(new.partner_user_id, new.partner_organization_id);
  new.answered_by_user_id := null;
  new.answered_at := null;

  -- SECURITY INVOKER on purpose (as guard_org_insert_sensitive_columns): for the
  -- service role and inside SECURITY DEFINER code current_user is not
  -- 'authenticated' and the status is left as given; so it is for verified staff.
  if current_user = 'authenticated' and not public.is_moderator() then
    new.status := 'pending';
  end if;
  return new;
end
$function$;

COMMENT ON FUNCTION public.partner_requests_before_insert() IS
  'BEFORE INSERT on partner_requests: resolves and checks marina_/partner_organization_id against the two users, clears the answer columns, and makes a self-service request start pending. 2026-10-08.';

DROP TRIGGER IF EXISTS trg_partner_requests_before_insert ON public.partner_requests;
CREATE TRIGGER trg_partner_requests_before_insert
  BEFORE INSERT ON public.partner_requests
  FOR EACH ROW EXECUTE FUNCTION public.partner_requests_before_insert();

-- ─── 4. BEFORE UPDATE ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_requests_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  -- Self-service only (SECURITY INVOKER, see the insert trigger): the service role,
  -- SECURITY DEFINER code and verified moderators/admins pass through.
  if current_user = 'authenticated' and not public.is_moderator() then
    if new.partner_user_id is distinct from old.partner_user_id
       or new.marina_user_id is distinct from old.marina_user_id
       or new.partner_organization_id is distinct from old.partner_organization_id
       or new.marina_organization_id is distinct from old.marina_organization_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Only the status of a connection request can change'
        using errcode = '42501';
    end if;

    if new.status is distinct from old.status then
      if v_uid is not null and v_uid = old.partner_user_id then
        -- The requester: withdraw or re-open (RLS), never answer.
        if new.status in ('accepted', 'rejected') then
          raise exception 'You cannot answer your own connection request'
            using errcode = '42501';
        end if;
      else
        -- The receiving company: one answer, from pending only. The first wins.
        if old.status <> 'pending' then
          raise exception 'This connection request has already been answered'
            using errcode = 'P0001', hint = 'already_answered';
        end if;
        if new.status not in ('accepted', 'rejected') then
          raise exception 'A connection request can only be accepted or declined'
            using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  -- Who answered, and when: written here only, whatever the client sent.
  if new.status is distinct from old.status and new.status in ('accepted', 'rejected') then
    new.answered_by_user_id := v_uid;
    new.answered_at := now();
  elsif new.status is distinct from old.status and new.status = 'pending' then
    new.answered_by_user_id := null;
    new.answered_at := null;
  else
    new.answered_by_user_id := old.answered_by_user_id;
    new.answered_at := old.answered_at;
  end if;
  return new;
end
$function$;

COMMENT ON FUNCTION public.partner_requests_before_update() IS
  'BEFORE UPDATE on partner_requests: identity columns are fixed for self-service updates, the receiving company answers once (pending -> accepted/rejected, first answer wins), and answered_by_user_id / answered_at record the answer. 2026-10-08.';

DROP TRIGGER IF EXISTS trg_partner_requests_before_update ON public.partner_requests;
CREATE TRIGGER trg_partner_requests_before_update
  BEFORE UPDATE ON public.partner_requests
  FOR EACH ROW EXECUTE FUNCTION public.partner_requests_before_update();

-- ─── 5. Policies ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS partner_requests_select ON public.partner_requests;
CREATE POLICY partner_requests_select ON public.partner_requests
  FOR SELECT TO authenticated
  USING (
    partner_user_id = (select auth.uid())
    OR marina_user_id = (select auth.uid())
    OR (marina_organization_id IS NOT NULL AND public.is_org_member(marina_organization_id))
    OR public.is_moderator()
  );

DROP POLICY IF EXISTS partner_requests_update ON public.partner_requests;
CREATE POLICY partner_requests_update ON public.partner_requests
  FOR UPDATE TO authenticated
  USING (
    public.is_moderator()
    OR marina_user_id = (select auth.uid())
    OR partner_user_id = (select auth.uid())
    OR (marina_organization_id IS NOT NULL AND public.is_org_member(marina_organization_id))
  )
  WITH CHECK (
    public.is_moderator()
    OR (
      (marina_user_id = (select auth.uid())
        OR (marina_organization_id IS NOT NULL AND public.is_org_member(marina_organization_id)))
      AND public.is_verified(NULL::public.persona_enum)
      AND status = ANY (ARRAY['accepted', 'rejected', 'pending']::public.partner_request_status_enum[])
    )
    OR (
      partner_user_id = (select auth.uid())
      AND public.is_verified(NULL::public.persona_enum)
      AND status = ANY (ARRAY['withdrawn', 'pending']::public.partner_request_status_enum[])
    )
  );

-- ─── 6. Backfill ───────────────────────────────────────────────────────────
-- updated_at must not move (send-notification reads it as "answered in the last 15
-- minutes"): its trigger is off for these few rows. The before-update guard lets the
-- migration role through (current_user is not 'authenticated').
ALTER TABLE public.partner_requests DISABLE TRIGGER trg_partner_requests_updated_at;

UPDATE public.partner_requests pr
   SET marina_organization_id  = coalesce(pr.marina_organization_id,  public.partner_request_user_org(pr.marina_user_id,  null)),
       partner_organization_id = coalesce(pr.partner_organization_id, public.partner_request_user_org(pr.partner_user_id, null))
 WHERE pr.marina_organization_id IS NULL
    OR pr.partner_organization_id IS NULL;

-- Already answered rows: until today only marina_user_id (or a moderator) could answer.
-- The trigger keeps OLD answer columns when the status does not change, so it is
-- disabled too for this one statement.
ALTER TABLE public.partner_requests DISABLE TRIGGER trg_partner_requests_before_update;

UPDATE public.partner_requests pr
   SET answered_by_user_id = pr.marina_user_id,
       answered_at = pr.updated_at
 WHERE pr.status IN ('accepted', 'rejected')
   AND pr.answered_at IS NULL;

ALTER TABLE public.partner_requests ENABLE TRIGGER trg_partner_requests_before_update;
ALTER TABLE public.partner_requests ENABLE TRIGGER trg_partner_requests_updated_at;
