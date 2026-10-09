-- DRY RUN of supabase/migrations/20261009190000_company_messaging.sql
--        and supabase/migrations/20261009190001_messages_digest_cron.sql (launch day)
-- NOT A MIGRATION: never apply it. NOTHING IS KEPT.
--
-- How to run: the WHOLE file in ONE execute_sql call (one implicit transaction).
-- Do not add BEGIN/COMMIT and do not run it statement by statement. The last
-- statement ends with RAISE EXCEPTION 'DRYRUN ...': the migrations, the cron job and
-- every test write roll back; the error text IS the report ("n PASS, m FAIL" first,
-- then one line per check; INFO lines are not counted).
-- Tripwire: if the report says "before-snapshot missing", the statements did NOT
-- run in one transaction and the migration may have been committed: check
-- information_schema.columns for partner_requests.auto_connected and cron.job for
-- 'messages-digest-friday' at once, and run the down scripts if they are there.
--
-- Layout
--   A. snapshot (partner_requests policies, row counts by status, cron jobs);
--   B. the two migrations, verbatim (the company messaging one, then the launch-day
--      cron one, so the job is checked too);
--   C. temp helper (pg_temp.dr: formats one report line);
--   D. one DO block: structural checks (S01-S11), then five scenarios (A to E),
--      each in its own sub-transaction rolled back before the next. Inside a
--      scenario the steps build on each other (a request, then replies, reads,
--      reports); a step that fails rolls back alone. Callers are simulated with
--      set local role authenticated / anon + request.jwt.claims {sub, role}.
--
-- Callers: looked up AT RUN TIME (read-only, as postgres), so no account id is
-- written in this public repository:
--   S   verified member (not admin/moderator) of a validated SERVICE-side company OS
--   C   another verified member of OS, if there is one (else INFO lines)
--   OM  a validated marina whose interest sectors overlap OS's services, with no
--       open request with OS; R = a verified member of OM (not of OS), R2 another
--   ON  a validated company whose sectors do NOT match OS (marina preferred), no
--       open request with OS; N = a verified member of ON
--   X   a verified outsider (in none of OS, OM, ON)
--   U   an unverified account with a company, if any (else INFO)
--   M   a verified admin
--
-- Scenarios: A sectors match (connected at once; reads, replies, digest, reports,
-- leavers and joiners, suspension, a deleted request); B no match (pending, manual
-- answer, first answer wins, nothing re-opened); C the first message's rules and the
-- old client (lengths, own name, own company, validated company, dates forced, 20 a
-- day); D 60 messages an hour and the read marker; E at most 5 automatic connections
-- per company a day.
--
-- Expected: "N PASS, 0 FAIL". The down scripts have their own dry run:
-- supabase/dryrun/20261009190000_company_messaging.down.dryrun.sql.

-- ─── 0. Locks ────────────────────────────────────────────────────────────────
-- Creating the tables locks partner_requests, profiles, organizations and auth.users
-- (their foreign keys) until the whole run rolls back, so live sign-ins and profile
-- edits wait meanwhile. Give up rather than queue behind a busy table, and never hold
-- the locks long. Run it at a quiet hour; if it stops on "lock timeout", run it again.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot ─────────────────────────────────────────────────────────────
create temp table _dr_before on commit drop as
  select 'policy ' || policyname as k,
         permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as v
    from pg_policies
   where schemaname = 'public' and tablename = 'partner_requests'
  union all
  select 'count ' || status::text, count(*)::text
    from public.partner_requests
   group by status
  union all
  select 'cron ' || jobname, schedule || '|' || command
    from cron.job;

-- ─── B. The migrations, verbatim ─────────────────────────────────────────────
-- Company-to-company messaging. Victor's decisions of 9 Oct 2026 (memory
-- "messaging-decisions"; roadmap docs/ROADMAP_POST_SM26.md, lot 8).
--
-- ════════════════════════════════════════════════════════════════════════════
-- What it does
-- ════════════════════════════════════════════════════════════════════════════
--  The connection stays a public.partner_requests row (company-wide since
--  20261008200000_partner_requests_whole_company.sql). On top of it:
--
--  1. Two new columns on partner_requests (additive, defaults):
--       origin          text     'message' for a first message sent from a company
--                                page by the new client; null for every other insert
--                                (the old client, Opportunities, Deal flow).
--       auto_connected  boolean  true when the connection was accepted at insert
--                                because the two companies' sectors overlap.
--  2. BEFORE INSERT trigger trg_partner_requests_msg_insert (fires after the
--     existing trg_partner_requests_before_insert, triggers run by name):
--       * every insert by a signed-in client: created_at and updated_at = now() (a
--         request dated in the past would escape the daily limit, one dated in the
--         future would stay unread and first in every list; no client sends them);
--       * every self-service insert (role authenticated, not a verified moderator):
--           - partner_user_id must be the caller (the old and new clients always
--             send it so; it stops anyone forging a request "from" someone else,
--             whose text would then read as theirs in the conversation);
--           - at most 20 new requests per sender in 24 h ("rate_limited").
--       * origin = 'message' only (the new "Send a message" of a company page):
--           - the text is trimmed and must be 1 to 500 characters;
--           - the sender must speak for a VALIDATED company (organizations.access_status
--             = 'verified'), and the receiving company must not be the sender's, must
--             have someone to receive it, and must not be suspended;
--           - one open conversation per pair of companies: refused when a pending or
--             accepted request already links them, either way ("already_connected");
--             a transaction lock on the pair makes two simultaneous sends wait for
--             each other, so the second is refused too;
--           - when the sectors match (msg_orgs_sectors_match, the rule of
--             src/lib/sector-matching.ts checkSectorMatch computed here: one company on
--             the interest side (marina, developer, investor), the other on the service
--             side (partner, media_partner), at least one sector in common between the
--             first's organization_interest_sectors and the second's
--             organization_service_sectors), the request is accepted at once:
--             status 'accepted', answered_by_user_id null, answered_at now(),
--             auto_connected true. No e-mail is sent for it (the client sends none).
--             The sectors are what each company ticked itself: at most 5 automatic
--             connections per sending company in 24 hours, then its messages wait
--             for an answer like the others;
--       * auto_connected is always computed here; whatever a client sends is ignored.
--     BEFORE UPDATE trigger trg_partner_requests_msg_update, self-service updates:
--       * origin and auto_connected cannot be changed;
--       * message and sector_id cannot be changed (the first message is the first of
--         the conversation, under its author's name; both clients only send status);
--       * an accepted or declined request is FINAL. The UPDATE policy of 20261008200000
--         lets the sender set 'withdrawn' or 'pending' from any status: the sender
--         could make a conversation vanish for both teams (and escape a report), or
--         put a declined message back in front of the company again and again. Neither
--         the old nor the new site has a screen that does it;
--       * re-opening a withdrawn request must not make a second open request between
--         the same two companies ("already_connected").
--  3. One more SELECT policy on partner_requests: the members of the SENDING company
--     (partner_organization_id) read its requests, so a colleague sees what their team
--     already wrote and the conversation belongs to both teams.
--  4. New tables (RLS on):
--       conversation_messages  the messages of an accepted connection, after its first
--                              message (which stays partner_requests.message and is
--                              shown first, by msg_thread). Read: verified members of
--                              either company, as they are NOW (msg_side: someone who
--                              left a company no longer reads or writes as it, even
--                              when they wrote or received the first message). Write:
--                              the same, as themselves, for their own side, unless M3
--                              suspended their company; the author's company is set by
--                              trigger. 60 messages per author per hour.
--                              No update or delete for members (deleted_at is for M3).
--       conversation_reads     (request, user, last_read_at): what each person has read.
--                              Written by msg_mark_read() only; a user reads their rows.
--       conversation_reports   "Report to M3": a verified member of either company
--                              reports a conversation, or a first message whatever its
--                              status (msg_can_report), with a reason; the trigger keeps
--                              an excerpt of the last 30 messages for M3 (who otherwise
--                              cannot read conversations; only the first message when
--                              the request is not accepted). 10 reports per person per
--                              day. Reporters read their reports; verified moderators
--                              read all and close them (B2B requests page of the admin).
--                              A report outlives its request (deleted with an account):
--                              partner_request_id becomes null, the excerpt stays.
--       digest_log             one row per person and week for the Friday digest
--                              (messages-digest edge function), with covered_until (the
--                              next digest starts there); service role only.
--  5. RPCs for the new client (SECURITY DEFINER, each checks the caller):
--       msg_conversations()         the caller's conversations with the other company,
--                                   last message, unread count
--       msg_thread(request)         one conversation, oldest first, with each author's
--                                   name, job title, photo and company
--       msg_mark_read(request, until) marks it read up to the newest message shown
--       msg_unread_count()          the unread messages of all the caller's conversations
--       msg_orgs_sectors_match(a,b) the sector rule above (public data)
--       msg_pair_open_request(a,b)  the open request between two companies, only when the
--                                   caller belongs to one of them (or the service role)
--       msg_can_report(request)     the caller may report it (policy helper)
--     Unread rule (one place, msg_unread_items): a message counts for a person when it
--     comes from the OTHER company (not them, not a colleague), is not deleted, and is
--     newer than their last_read_at in that conversation (when they never opened it:
--     the day they joined their company, so a new colleague does not inherit every
--     past message as unread). The first message counts too when the connection was
--     made automatically (nobody on the receiving side has seen it as a request);
--     after a manual acceptance it was already read as a request.
--  6. Friday digest: msg_digest_batch() (service role only) lists, per verified person
--     whose "B2B connections" e-mails are on (profiles.notification_prefs ->> 'b2b' not
--     'false', send-notification's TYPE_TO_CATEGORY category) and who has no digest
--     sent (or being sent) for this ISO week: the messages they have not read since
--     their last digest's covered_until (at most 30 days back; 7 days for a first
--     digest) with up to 3 previews, and the pending requests sent to their company in
--     that time (up to 5). The edge function messages-digest sends one e-mail per
--     person and logs it in digest_log.
--     public.invoke_messages_digest() POSTs the function with the Vault service key (the
--     pattern of invoke_send_profile_reminders), only on Fridays between 10:00 and 10:59
--     in Monaco (msg_digest_due, summer and winter time alike).
--     THE CRON JOB IS NOT IN THIS FILE: 20261009190001_messages_digest_cron.sql
--     schedules "messages-digest-friday" (08:00, 08:30, 09:00, 09:30 UTC on Fridays,
--     of which the 10:00 and 10:30 Monaco runs go ahead). Apply it, and deploy the
--     messages-digest function, only on the day the refonte replaces the old site.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Old client (main, live): unchanged
-- ════════════════════════════════════════════════════════════════════════════
--  It never sends origin, so none of the 'message' rules apply and it never
--  auto-connects. Its inserts always set partner_user_id to the signed-in user. Its
--  reads all filter on partner_user_id / marina_user_id, so the new SELECT policy
--  shows it nothing new (the admin counts run as moderators, who already read all).
--  The only changes it can meet: a 21st request by the same person within 24 h is
--  refused (the most anyone sent in a day so far is 10), and a request already
--  accepted or declined can no longer be withdrawn or re-opened by its sender (it
--  has no screen for either). It never sends created_at, updated_at, or anything but
--  status on an update, so the other new rules do not touch it. The new tables and
--  functions are unknown to it, and nothing in this file sends an e-mail or
--  schedules a job.
--
-- No sm_* or gl_* object is read or written. Idempotent (IF NOT EXISTS, OR REPLACE,
-- DROP POLICY IF EXISTS).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select tgname from pg_trigger where tgrelid = 'public.partner_requests'::regclass and not tgisinternal order by 1;
--     -> trg_partner_requests_before_insert, trg_partner_requests_before_update,
--        trg_partner_requests_msg_insert, trg_partner_requests_msg_update, trg_partner_requests_updated_at
--   select count(*) from public.partner_requests where auto_connected;            -> 0
--   select count(*) from cron.job where jobname = 'messages-digest-friday';      -> 0 (launch file)
--   select has_function_privilege('authenticated', 'public.msg_digest_batch(date, integer)', 'execute'); -> false
--   select is_nullable from information_schema.columns
--    where table_name = 'conversation_reports' and column_name = 'partner_request_id';         -> YES
--   select has_function_privilege('anon', 'public.msg_conversations()', 'execute');                       -> false
--
-- UNDO: supabase/migrations/down/20261009190000_company_messaging.down.sql
-- Dry run: supabase/dryrun/20261009190000_company_messaging.dryrun.sql (this file and
-- the launch file together), and ..._company_messaging.down.dryrun.sql (both up, then
-- both down, in one rolled-back transaction).

-- ─── 1. partner_requests: two columns ──────────────────────────────────────
ALTER TABLE public.partner_requests
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS auto_connected boolean NOT NULL DEFAULT false;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'partner_requests_origin_check'
       AND conrelid = 'public.partner_requests'::regclass
  ) THEN
    ALTER TABLE public.partner_requests
      ADD CONSTRAINT partner_requests_origin_check CHECK (origin IS NULL OR origin = 'message');
  END IF;
END
$do$;

COMMENT ON COLUMN public.partner_requests.origin IS
  '''message'' = a first message sent from a company page (new client, 2026-10-09); null otherwise. Turns on the messaging rules of trg_partner_requests_msg_insert.';
COMMENT ON COLUMN public.partner_requests.auto_connected IS
  'True when the request was accepted at insert because the two companies'' sectors overlap (msg_orgs_sectors_match). Set by trigger only. 2026-10-09.';

CREATE INDEX IF NOT EXISTS partner_requests_sender_created_idx
  ON public.partner_requests (partner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_requests_org_pair_idx
  ON public.partner_requests (partner_organization_id, marina_organization_id);
CREATE INDEX IF NOT EXISTS partner_requests_marina_org_status_idx
  ON public.partner_requests (marina_organization_id, status);

-- ─── 2. Helpers ────────────────────────────────────────────────────────────

-- The organisations a user belongs to: organization_members, plus the one they own
-- (owner_user_id), as partner_request_user_org() reads them. Internal.
CREATE OR REPLACE FUNCTION public.msg_user_org_ids(p_user uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(distinct x.org_id), '{}'::uuid[])
    from (
      select m.organization_id as org_id
        from public.organization_members m
       where m.user_id = p_user
      union
      select o.id
        from public.organizations o
       where o.owner_user_id = p_user
    ) x
   where p_user is not null;
$function$;

-- Which side of a request a user is on: 'partner' (the company that wrote first) or
-- 'marina' (the company that received it), null when neither. Internal.
-- A side that names a company is that company's members, NOW: the person who wrote
-- or received the request no longer speaks for it once they have left it. The
-- person counts only for a side without a company (none on 9 Oct 2026).
CREATE OR REPLACE FUNCTION public.msg_side(p_request uuid, p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
           when (r.partner_organization_id is not null and r.partner_organization_id = any (o.orgs))
             or (r.partner_organization_id is null and r.partner_user_id = p_user) then 'partner'
           when (r.marina_organization_id is not null and r.marina_organization_id = any (o.orgs))
             or (r.marina_organization_id is null and r.marina_user_id = p_user) then 'marina'
         end
    from public.partner_requests r
   cross join (select public.msg_user_org_ids(p_user) as orgs) o
   where r.id = p_request
     and p_user is not null;
$function$;

-- The signed-in account may read and write this conversation: verified, the request
-- is accepted, and they are on one of its two sides.
CREATE OR REPLACE FUNCTION public.msg_can_access(p_request uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
           public.is_verified(NULL::public.persona_enum)
           and exists (select 1 from public.partner_requests r where r.id = p_request and r.status = 'accepted')
           and public.msg_side(p_request, auth.uid()) is not null,
           false);
$function$;

-- The company the signed-in account speaks for in this conversation (null when
-- that side has no company, e.g. an old request from someone without one).
CREATE OR REPLACE FUNCTION public.msg_my_side_org(p_request uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case public.msg_side(r.id, auth.uid())
           when 'partner' then r.partner_organization_id
           when 'marina' then r.marina_organization_id
         end
    from public.partner_requests r
   where r.id = p_request;
$function$;

-- The signed-in account may report this request or conversation to M3: verified and
-- on one of its two sides, whatever its status (an unwanted first message waiting for
-- an answer, or one already declined, can be reported too).
CREATE OR REPLACE FUNCTION public.msg_can_report(p_request uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
           public.is_verified(NULL::public.persona_enum)
           and public.msg_side(p_request, auth.uid()) is not null,
           false);
$function$;

-- A message may be written as this company in this conversation. A company M3 has
-- suspended still reads its conversations but writes no more.
CREATE OR REPLACE FUNCTION public.msg_can_write(p_request uuid, p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.msg_can_access(p_request)
     and p_org is not distinct from public.msg_my_side_org(p_request)
     and not exists (select 1 from public.organizations o
                      where o.id = p_org and o.access_status = 'suspended');
$function$;

-- The sector rule (src/lib/sector-matching.ts, checkSectorMatch with an overlap):
-- one company on the interest side (marina, developer, investor) and the other on
-- the service side (partner, media_partner), with at least one sector of the first's
-- interests among the second's services. Same-side pairs never match. Public data.
CREATE OR REPLACE FUNCTION public.msg_orgs_sectors_match(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with t as (
    select o.id,
           case
             when o.organization_type in ('marina', 'developer', 'investor') then 'interest'
             when o.organization_type in ('partner', 'media_partner') then 'service'
           end as side
      from public.organizations o
     where o.id in (p_a, p_b)
  )
  select coalesce(
           p_a is not null and p_b is not null and p_a <> p_b
           and (select count(*) from t where t.side is not null) = 2
           and (select count(distinct t.side) from t) = 2
           and exists (
             select 1
               from t ti
               join public.organization_interest_sectors i on i.organization_id = ti.id
               join t ts on ts.side = 'service'
               join public.organization_service_sectors s on s.organization_id = ts.id and s.sector_id = i.sector_id
              where ti.side = 'interest'
           ),
           false);
$function$;

-- The open (pending or accepted) request between two companies, either way, accepted
-- first. Answers only a caller who belongs to one of the two (or a caller with no
-- account: the service role, SQL): who talks to whom is not public.
CREATE OR REPLACE FUNCTION public.msg_pair_open_request(p_a uuid, p_b uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id
    from public.partner_requests r
   where r.status in ('pending', 'accepted')
     and ((r.partner_organization_id = p_a and r.marina_organization_id = p_b)
       or (r.partner_organization_id = p_b and r.marina_organization_id = p_a))
     and (auth.uid() is null
       or p_a = any (public.msg_user_org_ids(auth.uid()))
       or p_b = any (public.msg_user_org_ids(auth.uid())))
   order by (r.status = 'accepted') desc, r.created_at desc
   limit 1;
$function$;

-- ─── 3. partner_requests triggers ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.partner_requests_msg_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_self boolean := current_user = 'authenticated' and not public.is_moderator();
  v_recent integer;
  v_target_status text;
begin
  new.auto_connected := false;

  -- A signed-in client never dates its own request: a request dated in the past
  -- would escape the 24-hour limit below, one dated in the future would stay unread
  -- and on top of every list for ever (neither client sends these columns).
  if current_user = 'authenticated' then
    new.created_at := now();
    new.updated_at := now();
  end if;

  if v_self then
    -- Nobody writes in someone else's name (both clients always send themselves).
    if new.partner_user_id is distinct from auth.uid() then
      raise exception 'A message can only be sent in your own name'
        using errcode = '42501';
    end if;
    -- At most 20 new conversations or requests per person in 24 hours.
    select count(*) into v_recent
      from public.partner_requests r
     where r.partner_user_id = new.partner_user_id
       and r.created_at > now() - interval '24 hours';
    if v_recent >= 20 then
      raise exception 'You have reached the limit of 20 new messages to companies in 24 hours. Please try again tomorrow.'
        using errcode = 'P0001', hint = 'rate_limited';
    end if;
  end if;

  if new.origin = 'message' then
    new.message := btrim(coalesce(new.message, ''));
    if char_length(new.message) < 1 or char_length(new.message) > 500 then
      raise exception 'Your message must be between 1 and 500 characters'
        using errcode = '22023', hint = 'message_length';
    end if;
    if new.partner_organization_id is null
       or not exists (select 1 from public.organizations o
                       where o.id = new.partner_organization_id and o.access_status = 'verified') then
      raise exception 'Only members of a company validated by M3 can send messages'
        using errcode = '42501', hint = 'company_not_validated';
    end if;
    if new.marina_organization_id is null then
      raise exception 'This company has nobody on the platform to receive your message yet'
        using errcode = 'P0001', hint = 'no_team';
    end if;
    if new.marina_organization_id = new.partner_organization_id then
      raise exception 'You cannot send a message to your own company'
        using errcode = 'P0001', hint = 'own_company';
    end if;
    select o.access_status into v_target_status from public.organizations o where o.id = new.marina_organization_id;
    if v_target_status = 'suspended' then
      raise exception 'This company cannot receive messages at the moment'
        using errcode = 'P0001', hint = 'target_suspended';
    end if;
    -- Two colleagues writing to the same company at the same moment: the second waits
    -- here for the first to commit, then sees its request (each statement of this
    -- function reads afresh) and is refused.
    perform pg_advisory_xact_lock(hashtextextended(
      'msg_pair:' || least(new.partner_organization_id, new.marina_organization_id)::text
        || ':' || greatest(new.partner_organization_id, new.marina_organization_id)::text, 0));
    if public.msg_pair_open_request(new.partner_organization_id, new.marina_organization_id) is not null then
      raise exception 'Your companies are already in touch: open the conversation in Messages'
        using errcode = '23505', hint = 'already_connected';
    end if;

    -- Sectors match: connected at once. The sectors are what each company ticked
    -- itself, so a company that ticks every sector is not connected with everyone:
    -- at most 5 automatic connections per sending company in 24 hours; after that
    -- its messages wait for the other company's answer like any other.
    if new.status = 'pending'
       and public.msg_orgs_sectors_match(new.partner_organization_id, new.marina_organization_id)
       and (select count(*) from public.partner_requests r
             where r.partner_organization_id = new.partner_organization_id
               and r.auto_connected
               and r.created_at > now() - interval '24 hours') < 5 then
      new.status := 'accepted';
      new.answered_by_user_id := null;
      new.answered_at := now();
      new.auto_connected := true;
    end if;
  end if;
  return new;
end
$function$;

COMMENT ON FUNCTION public.partner_requests_msg_before_insert() IS
  'BEFORE INSERT on partner_requests (after trg_partner_requests_before_insert): created_at/updated_at = now() for signed-in clients; own name and 20 per 24 h for self-service inserts; for origin = message: 1-500 characters, validated sender company, one open conversation per pair of companies, accepted at once when the sectors match (auto_connected; at most 5 per sending company in 24 h). 2026-10-09.';

DROP TRIGGER IF EXISTS trg_partner_requests_msg_insert ON public.partner_requests;
CREATE TRIGGER trg_partner_requests_msg_insert
  BEFORE INSERT ON public.partner_requests
  FOR EACH ROW EXECUTE FUNCTION public.partner_requests_msg_before_insert();

-- Self-service updates (SECURITY INVOKER: the service role, SECURITY DEFINER code,
-- verified moderators and foreign-key actions pass through):
--   * origin and auto_connected stay as they are;
--   * an answered request is final: once accepted (a conversation both companies
--     read) or declined, nobody moves it any more. The existing UPDATE policy let
--     the sender set 'withdrawn' or 'pending' from ANY status, so the sender could
--     make a conversation vanish for both teams (and escape a report), or put a
--     declined message back in front of the company again and again. The receiving
--     side was already limited to one answer (partner_requests_before_update). No
--     screen of the old or the new site withdraws or re-opens a request;
--   * a withdrawn request re-opened by its sender must not make a second open
--     request between the two companies;
--   * the first message (and the sector of an RFP interest) never changes: it is
--     the first message of the conversation, shown under its author's name and
--     copied into M3's reports, and its 500 characters are checked at insert.
--     Both clients only ever send {status}.
CREATE OR REPLACE FUNCTION public.partner_requests_msg_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user = 'authenticated' and not public.is_moderator() then
    new.origin := old.origin;
    new.auto_connected := old.auto_connected;
    if new.message is distinct from old.message or new.sector_id is distinct from old.sector_id then
      raise exception 'Only the status of a request can change'
        using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      if old.status in ('accepted', 'rejected') then
        raise exception 'This request has already been answered and can no longer be changed'
          using errcode = 'P0001', hint = 'already_answered';
      end if;
      if new.status = 'pending'
         and old.partner_organization_id is not null and old.marina_organization_id is not null
         and public.msg_pair_open_request(old.partner_organization_id, old.marina_organization_id) is not null then
        raise exception 'Your companies are already in touch: open the conversation in Messages'
          using errcode = '23505', hint = 'already_connected';
      end if;
    end if;
  end if;
  return new;
end
$function$;

COMMENT ON FUNCTION public.partner_requests_msg_before_update() IS
  'BEFORE UPDATE on partner_requests, self-service only: origin and auto_connected stay as they are; message and sector_id cannot change; an accepted or declined request is final; a re-opened request must not duplicate an open one between the same companies. 2026-10-09.';

DROP TRIGGER IF EXISTS trg_partner_requests_msg_update ON public.partner_requests;
CREATE TRIGGER trg_partner_requests_msg_update
  BEFORE UPDATE ON public.partner_requests
  FOR EACH ROW EXECUTE FUNCTION public.partner_requests_msg_before_update();

-- ─── 4. partner_requests: the sending company reads its requests ────────────
DROP POLICY IF EXISTS partner_requests_select_sender_org ON public.partner_requests;
CREATE POLICY partner_requests_select_sender_org ON public.partner_requests
  FOR SELECT TO authenticated
  USING (partner_organization_id IS NOT NULL AND public.is_org_member(partner_organization_id));

-- ─── 5. Tables ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_request_id uuid NOT NULL REFERENCES public.partner_requests(id) ON DELETE CASCADE,
  author_user_id     uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  author_org_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  body               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CONSTRAINT conversation_messages_body_length CHECK (char_length(body) BETWEEN 1 AND 4000 AND btrim(body) <> '')
);

COMMENT ON TABLE public.conversation_messages IS
  'Messages between two companies once their partner_requests row is accepted. The first message is partner_requests.message (shown first by msg_thread). Read/write: verified members of either company. 2026-10-09.';

CREATE INDEX IF NOT EXISTS conversation_messages_request_created_idx
  ON public.conversation_messages (partner_request_id, created_at);
CREATE INDEX IF NOT EXISTS conversation_messages_author_created_idx
  ON public.conversation_messages (author_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.conversation_reads (
  partner_request_id uuid NOT NULL REFERENCES public.partner_requests(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  last_read_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_request_id, user_id)
);

COMMENT ON TABLE public.conversation_reads IS
  'When each person last opened each conversation (msg_mark_read). Drives the unread counts and the Friday digest. 2026-10-09.';

CREATE INDEX IF NOT EXISTS conversation_reads_user_idx ON public.conversation_reads (user_id);

-- partner_request_id is SET NULL, not CASCADE: a request goes when the account that
-- sent or received it is deleted (partner_requests' user columns cascade from
-- profiles), and the report, with its excerpt, must stay for M3.
CREATE TABLE IF NOT EXISTS public.conversation_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_request_id uuid REFERENCES public.partner_requests(id) ON DELETE SET NULL,
  message_id         uuid REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  reporter_user_id   uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  reporter_org_id    uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  reason             text NOT NULL,
  excerpt            text,
  status             text NOT NULL DEFAULT 'open',
  staff_note         text,
  handled_by         uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  handled_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_reports_reason_length CHECK (char_length(reason) BETWEEN 1 AND 1000 AND btrim(reason) <> ''),
  CONSTRAINT conversation_reports_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT conversation_reports_note_length CHECK (staff_note IS NULL OR char_length(staff_note) <= 2000)
);

COMMENT ON TABLE public.conversation_reports IS
  '"Report to M3" on a conversation. excerpt = the last 30 messages at the time of the report (M3 cannot read conversations otherwise; only the first message when the request is not accepted). Moderators read and close them. partner_request_id becomes null when the request is deleted; the report stays. 2026-10-09.';

CREATE INDEX IF NOT EXISTS conversation_reports_status_created_idx
  ON public.conversation_reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.digest_log (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'messages',
  week_start    date NOT NULL,
  status        text NOT NULL DEFAULT 'sending',
  message_count integer NOT NULL DEFAULT 0,
  request_count integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  covered_until timestamptz,
  PRIMARY KEY (user_id, kind, week_start),
  CONSTRAINT digest_log_status_check CHECK (status IN ('sending', 'sent'))
);

COMMENT ON TABLE public.digest_log IS
  'One row per person, kind and ISO week (Monday) of a digest e-mail: claimed (sending) before the e-mail, sent after, deleted when the send failed so a re-run retries. A re-run in the same week skips everyone with a sent row, or a sending row less than 15 minutes old (an older one is a run that died: retried). covered_until = the time msg_digest_batch read the data (as_of): the next digest starts there. Service role only. 2026-10-09.';

-- ─── 6. Table triggers ─────────────────────────────────────────────────────

-- A member's message: written as themselves, for their side's company, now, trimmed;
-- 60 per author per hour. SECURITY DEFINER (counts across all conversations); the
-- caller is recognised by auth.uid() (null for the service role and SQL).
CREATE OR REPLACE FUNCTION public.conversation_messages_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_recent integer;
begin
  if v_uid is not null then
    new.author_user_id := v_uid;
    new.author_org_id := public.msg_my_side_org(new.partner_request_id);
    new.created_at := now();
    new.deleted_at := null;
    new.body := btrim(coalesce(new.body, ''));
    select count(*) into v_recent
      from public.conversation_messages m
     where m.author_user_id = v_uid
       and m.created_at > now() - interval '1 hour';
    if v_recent >= 60 then
      raise exception 'You have sent many messages in the last hour. Please wait a little before sending more.'
        using errcode = 'P0001', hint = 'rate_limited';
    end if;
  end if;
  return new;
end
$function$;

DROP TRIGGER IF EXISTS trg_conversation_messages_before_insert ON public.conversation_messages;
CREATE TRIGGER trg_conversation_messages_before_insert
  BEFORE INSERT ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.conversation_messages_before_insert();

-- What M3 receives with a report: the last 30 messages of the conversation (the
-- first message included), oldest first, one line each. Internal. When the request
-- is not (or no longer) accepted, only the first message: a conversation M3 has
-- closed must not come back through a report filed by someone who can no longer
-- read it.
CREATE OR REPLACE FUNCTION public.msg_report_excerpt(p_request uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select string_agg(
           format('%s UTC · %s (%s): %s',
                  to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
                  coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Unknown person'),
                  coalesce(o.name, 'no company'),
                  case when x.deleted_at is not null then '[removed]' else left(x.body, 600) end),
           E'\n' order by x.created_at)
    from (
      select * from (
        select r.partner_user_id as author_user_id, r.partner_organization_id as author_org_id,
               btrim(r.message) as body, r.created_at, null::timestamptz as deleted_at
          from public.partner_requests r
         where r.id = p_request and nullif(btrim(r.message), '') is not null
        union all
        select m.author_user_id, m.author_org_id, m.body, m.created_at, m.deleted_at
          from public.conversation_messages m
         where m.partner_request_id = p_request
           and exists (select 1 from public.partner_requests r2
                        where r2.id = p_request and r2.status = 'accepted')
      ) a
      order by a.created_at desc
      limit 30
    ) x
    left join public.profiles p on p.user_id = x.author_user_id
    left join public.organizations o on o.id = x.author_org_id;
$function$;

CREATE OR REPLACE FUNCTION public.conversation_reports_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_recent integer;
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.reporter_user_id := v_uid;
      new.reporter_org_id := public.msg_my_side_org(new.partner_request_id);
      new.status := 'open';
      new.staff_note := null;
      new.handled_by := null;
      new.handled_at := null;
      new.created_at := now();
      new.reason := btrim(coalesce(new.reason, ''));
      select count(*) into v_recent
        from public.conversation_reports c
       where c.reporter_user_id = v_uid
         and c.created_at > now() - interval '24 hours';
      if v_recent >= 10 then
        raise exception 'You have sent many reports today. Please write to M3 at events@m3monaco.com.'
          using errcode = 'P0001', hint = 'rate_limited';
      end if;
    end if;
    -- A reported message must belong to the reported conversation.
    if new.message_id is not null and not exists (
      select 1 from public.conversation_messages m
       where m.id = new.message_id and m.partner_request_id = new.partner_request_id) then
      new.message_id := null;
    end if;
    new.excerpt := public.msg_report_excerpt(new.partner_request_id);
  else
    -- A foreign key's ON DELETE SET NULL (a profile, company or message deleted)
    -- arrives here as an UPDATE fired from another trigger: let it through, or the
    -- report would keep pointing at a row that no longer exists.
    if pg_trigger_depth() > 1 then
      return new;
    end if;
    -- Moderators (RLS) close or reopen a report; the rest stays as reported.
    new.partner_request_id := old.partner_request_id;
    new.message_id := old.message_id;
    new.reporter_user_id := old.reporter_user_id;
    new.reporter_org_id := old.reporter_org_id;
    new.reason := old.reason;
    new.excerpt := old.excerpt;
    new.created_at := old.created_at;
    if new.status is distinct from old.status then
      new.handled_by := v_uid;
      new.handled_at := now();
    else
      new.handled_by := old.handled_by;
      new.handled_at := old.handled_at;
    end if;
  end if;
  return new;
end
$function$;

DROP TRIGGER IF EXISTS trg_conversation_reports_before_write ON public.conversation_reports;
CREATE TRIGGER trg_conversation_reports_before_write
  BEFORE INSERT OR UPDATE ON public.conversation_reports
  FOR EACH ROW EXECUTE FUNCTION public.conversation_reports_before_write();

-- ─── 7. RLS and privileges on the tables ───────────────────────────────────
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digest_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_messages_select ON public.conversation_messages;
CREATE POLICY conversation_messages_select ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (public.msg_can_access(partner_request_id));

DROP POLICY IF EXISTS conversation_messages_insert ON public.conversation_messages;
CREATE POLICY conversation_messages_insert ON public.conversation_messages
  FOR INSERT TO authenticated
  WITH CHECK (author_user_id = (select auth.uid()) AND public.msg_can_write(partner_request_id, author_org_id));

DROP POLICY IF EXISTS conversation_reads_select_own ON public.conversation_reads;
CREATE POLICY conversation_reads_select_own ON public.conversation_reads
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS conversation_reports_insert ON public.conversation_reports;
CREATE POLICY conversation_reports_insert ON public.conversation_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_user_id = (select auth.uid()) AND public.msg_can_report(partner_request_id));

DROP POLICY IF EXISTS conversation_reports_select ON public.conversation_reports;
CREATE POLICY conversation_reports_select ON public.conversation_reports
  FOR SELECT TO authenticated
  USING (reporter_user_id = (select auth.uid()) OR public.is_moderator());

DROP POLICY IF EXISTS conversation_reports_update_staff ON public.conversation_reports;
CREATE POLICY conversation_reports_update_staff ON public.conversation_reports
  FOR UPDATE TO authenticated
  USING (public.is_moderator())
  WITH CHECK (public.is_moderator());

-- digest_log: no policy (service role only).

REVOKE ALL ON TABLE public.conversation_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.conversation_reads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.conversation_reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.digest_log FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.conversation_messages TO authenticated;
GRANT SELECT ON TABLE public.conversation_reads TO authenticated;
GRANT SELECT, INSERT ON TABLE public.conversation_reports TO authenticated;
GRANT UPDATE (status, staff_note) ON TABLE public.conversation_reports TO authenticated;

GRANT ALL ON TABLE public.conversation_messages TO service_role;
GRANT ALL ON TABLE public.conversation_reads TO service_role;
GRANT ALL ON TABLE public.conversation_reports TO service_role;
GRANT ALL ON TABLE public.digest_log TO service_role;

-- ─── 8. Unread rule and the client RPCs ────────────────────────────────────

-- THE unread rule (see the header), for any user: internal (the client RPCs pass
-- auth.uid(); the digest passes each recipient). Accepted conversations only, of the
-- companies the user belongs to now (msg_side's rule). Someone who never opened a
-- conversation counts from the day they joined their company: a new colleague does
-- not find every past message unread.
CREATE OR REPLACE FUNCTION public.msg_unread_items(p_user uuid, p_since timestamptz DEFAULT NULL)
 RETURNS TABLE (
   partner_request_id uuid,
   message_id uuid,
   author_user_id uuid,
   author_org_id uuid,
   body text,
   created_at timestamptz,
   is_first boolean
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with mine as (
    select public.msg_user_org_ids(p_user) as orgs
  ),
  threads as (
    select r.id, r.partner_user_id, r.partner_organization_id, r.message, r.created_at, r.auto_connected,
           coalesce(rd.last_read_at,
                    (select min(om.joined_at) from public.organization_members om
                      where om.user_id = p_user
                        and om.organization_id in (r.partner_organization_id, r.marina_organization_id)),
                    '-infinity'::timestamptz) as last_read_at
      from public.partner_requests r
     cross join mine
      left join public.conversation_reads rd on rd.partner_request_id = r.id and rd.user_id = p_user
     where p_user is not null
       and r.status = 'accepted'
       and ((r.partner_organization_id is not null and r.partner_organization_id = any (mine.orgs))
         or (r.partner_organization_id is null and r.partner_user_id = p_user)
         or (r.marina_organization_id is not null and r.marina_organization_id = any (mine.orgs))
         or (r.marina_organization_id is null and r.marina_user_id = p_user))
  )
  select t.id, m.id, m.author_user_id, m.author_org_id, m.body, m.created_at, false
    from threads t
    join public.conversation_messages m on m.partner_request_id = t.id
   cross join mine
   where m.deleted_at is null
     and m.author_user_id is distinct from p_user
     and (m.author_org_id is null or not (m.author_org_id = any (mine.orgs)))
     and m.created_at > t.last_read_at
     and m.created_at > coalesce(p_since, '-infinity'::timestamptz)
  union all
  select t.id, null::uuid, t.partner_user_id, t.partner_organization_id, btrim(t.message), t.created_at, true
    from threads t
   cross join mine
   where t.auto_connected
     and nullif(btrim(t.message), '') is not null
     and t.partner_user_id is distinct from p_user
     and (t.partner_organization_id is null or not (t.partner_organization_id = any (mine.orgs)))
     and t.created_at > t.last_read_at
     and t.created_at > coalesce(p_since, '-infinity'::timestamptz);
$function$;

-- The signed-in account's unread messages, all conversations (navbar dot, dashboard tile).
CREATE OR REPLACE FUNCTION public.msg_unread_count()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
           when auth.uid() is null or not public.is_verified(NULL::public.persona_enum) then 0
           else (select count(*)::integer from public.msg_unread_items(auth.uid(), null))
         end;
$function$;

-- The signed-in account's conversations, most recent activity first.
CREATE OR REPLACE FUNCTION public.msg_conversations()
 RETURNS TABLE (
   partner_request_id uuid,
   my_side text,
   my_org_id uuid,
   other_org_id uuid,
   other_org_name text,
   other_org_slug text,
   other_org_logo_url text,
   other_org_type text,
   other_person_name text,
   auto_connected boolean,
   started_at timestamptz,
   connected_at timestamptz,
   last_message_at timestamptz,
   last_message_preview text,
   last_author_name text,
   last_from_my_side boolean,
   unread_count integer
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select auth.uid() as uid, public.msg_user_org_ids(auth.uid()) as orgs
  ),
  threads as (
    select r.id, r.partner_user_id, r.marina_user_id, r.partner_organization_id, r.marina_organization_id,
           r.message, r.created_at, r.answered_at, r.auto_connected,
           case
             when (r.partner_organization_id is not null and r.partner_organization_id = any (me.orgs))
               or (r.partner_organization_id is null and r.partner_user_id = me.uid) then 'partner'
             else 'marina'
           end as side
      from public.partner_requests r
     cross join me
     where me.uid is not null
       and public.is_verified(NULL::public.persona_enum)
       and r.status = 'accepted'
       and ((r.partner_organization_id is not null and r.partner_organization_id = any (me.orgs))
         or (r.partner_organization_id is null and r.partner_user_id = me.uid)
         or (r.marina_organization_id is not null and r.marina_organization_id = any (me.orgs))
         or (r.marina_organization_id is null and r.marina_user_id = me.uid))
  ),
  unread as (
    select u.partner_request_id, count(*)::integer as n
      from me
     cross join lateral public.msg_unread_items(me.uid, null) u
     group by u.partner_request_id
  ),
  last_msg as (
    select distinct on (m.partner_request_id)
           m.partner_request_id, m.body, m.created_at, m.author_user_id, m.author_org_id
      from public.conversation_messages m
      join threads t on t.id = m.partner_request_id
     where m.deleted_at is null
     order by m.partner_request_id, m.created_at desc
  )
  select t.id,
         t.side,
         case when t.side = 'partner' then t.partner_organization_id else t.marina_organization_id end,
         o.id,
         o.name,
         o.slug,
         o.logo_url,
         o.organization_type,
         nullif(btrim(concat_ws(' ', op.first_name, op.last_name)), ''),
         t.auto_connected,
         t.created_at,
         coalesce(t.answered_at, t.created_at),
         coalesce(lm.created_at, t.created_at),
         left(regexp_replace(btrim(coalesce(lm.body, t.message, '')), '\s+', ' ', 'g'), 160),
         nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
         case
           when lm.partner_request_id is not null
             then coalesce(lm.author_user_id = me.uid, false) or coalesce(lm.author_org_id = any (me.orgs), false)
           else t.side = 'partner'
         end,
         coalesce(un.n, 0)
    from threads t
   cross join me
    left join public.organizations o
           on o.id = case when t.side = 'partner' then t.marina_organization_id else t.partner_organization_id end
    left join public.profiles op
           on op.user_id = case when t.side = 'partner' then t.marina_user_id else t.partner_user_id end
    left join last_msg lm on lm.partner_request_id = t.id
    left join public.profiles ap on ap.user_id = coalesce(lm.author_user_id, t.partner_user_id)
    left join unread un on un.partner_request_id = t.id
   order by greatest(coalesce(lm.created_at, t.created_at), coalesce(t.answered_at, t.created_at)) desc;
$function$;

-- One conversation, oldest first (the last 300 messages), the first message
-- (partner_requests.message) included with is_first = true and the request's id.
-- Empty when the caller may not read it.
CREATE OR REPLACE FUNCTION public.msg_thread(p_request uuid)
 RETURNS TABLE (
   id uuid,
   author_user_id uuid,
   author_name text,
   author_job_title text,
   author_avatar_url text,
   author_org_id uuid,
   author_org_name text,
   body text,
   created_at timestamptz,
   is_first boolean,
   from_my_side boolean,
   is_deleted boolean
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select auth.uid() as uid, public.msg_user_org_ids(auth.uid()) as orgs
     where public.msg_can_access(p_request)
  ),
  items as (
    select * from (
      select r.id, r.partner_user_id as author_user_id, r.partner_organization_id as author_org_id,
             btrim(r.message) as body, r.created_at, true as is_first, null::timestamptz as deleted_at
        from public.partner_requests r
       where r.id = p_request
         and nullif(btrim(r.message), '') is not null
      union all
      select m.id, m.author_user_id, m.author_org_id, m.body, m.created_at, false, m.deleted_at
        from public.conversation_messages m
       where m.partner_request_id = p_request
    ) a
    order by a.created_at desc, a.is_first
    limit 300
  )
  select i.id,
         i.author_user_id,
         nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
         p.job_title,
         p.avatar_url,
         i.author_org_id,
         o.name,
         case when i.deleted_at is null then i.body end,
         i.created_at,
         i.is_first,
         coalesce(i.author_user_id = me.uid, false) or coalesce(i.author_org_id = any (me.orgs), false),
         i.deleted_at is not null
    from items i
   cross join me
    left join public.profiles p on p.user_id = i.author_user_id
    left join public.organizations o on o.id = i.author_org_id
   order by i.created_at, i.is_first desc;
$function$;

-- Marks a conversation read for the signed-in account, up to p_until: the time of the
-- newest message the screen has shown (now when not given, never later than now). A
-- message that arrives between the screen's read and this call stays unread. The
-- marker never moves back.
CREATE OR REPLACE FUNCTION public.msg_mark_read(p_request uuid, p_until timestamptz DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_at timestamptz := least(now(), coalesce(p_until, now()));
begin
  if not public.msg_can_access(p_request) then
    raise exception 'You cannot open this conversation' using errcode = '42501';
  end if;
  insert into public.conversation_reads (partner_request_id, user_id, last_read_at)
  values (p_request, auth.uid(), v_at)
  on conflict (partner_request_id, user_id)
    do update set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at);
end
$function$;

-- ─── 9. Friday digest ──────────────────────────────────────────────────────

-- Who gets this week's digest, and what it says. Service role only.
--   since  where this person's digest starts: covered_until of their last digest
--          sent (7 days back for a first one, never more than 30);
--   as_of  when this batch read the data: the edge function stores it as the
--          digest's covered_until, so whatever arrives while the e-mails go out is in
--          the next digest, never lost between two.
-- A person is left out when this week's digest was sent, or is being sent by a run
-- that started less than 15 minutes ago; an older 'sending' row is a run that died
-- (the function deletes it before claiming the person again).
CREATE OR REPLACE FUNCTION public.msg_digest_batch(p_week_start date DEFAULT NULL, p_limit integer DEFAULT 500)
 RETURNS TABLE (
   user_id uuid,
   email text,
   first_name text,
   week_start date,
   since timestamptz,
   as_of timestamptz,
   message_count integer,
   previews jsonb,
   request_count integer,
   requests jsonb
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with wk as (
    select coalesce(p_week_start, (date_trunc('week', now() at time zone 'UTC'))::date) as w
  ),
  people as (
    select p.user_id,
           coalesce(nullif(btrim(p.email), ''), u.email::text) as email,
           p.first_name,
           public.msg_user_org_ids(p.user_id) as orgs,
           greatest(
             coalesce((select max(coalesce(d.covered_until, d.sent_at)) from public.digest_log d
                        where d.user_id = p.user_id and d.kind = 'messages' and d.status = 'sent'),
                      now() - interval '7 days'),
             now() - interval '30 days') as since
      from public.profiles p
      join auth.users u on u.id = p.user_id
     cross join wk
     where p.access_status = 'verified'
       and coalesce(p.notification_prefs ->> 'b2b', 'true') <> 'false'
       and not exists (select 1 from public.digest_log d
                        where d.user_id = p.user_id and d.kind = 'messages' and d.week_start = wk.w
                          and (d.status = 'sent' or d.created_at > now() - interval '15 minutes'))
  ),
  msgs as (
    select pe.user_id, x.author_user_id, x.author_org_id, x.body, x.created_at,
           row_number() over (partition by pe.user_id order by x.created_at desc) as rn,
           count(*) over (partition by pe.user_id) as n
      from people pe
     cross join lateral public.msg_unread_items(pe.user_id, pe.since) x
  ),
  msg_agg as (
    select m.user_id,
           max(m.n)::integer as n,
           coalesce(jsonb_agg(jsonb_build_object(
             'name', coalesce(nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''), 'A member'),
             'company', coalesce(ao.name, ''),
             'text', left(regexp_replace(btrim(m.body), '\s+', ' ', 'g'), 140),
             'at', m.created_at) order by m.created_at desc) filter (where m.rn <= 3), '[]'::jsonb) as previews
      from msgs m
      left join public.profiles ap on ap.user_id = m.author_user_id
      left join public.organizations ao on ao.id = m.author_org_id
     group by m.user_id
  ),
  reqs as (
    select pe.user_id, r.partner_user_id, r.partner_organization_id, r.message, r.created_at,
           row_number() over (partition by pe.user_id order by r.created_at desc) as rn,
           count(*) over (partition by pe.user_id) as n
      from people pe
      join public.partner_requests r
        on r.status = 'pending'
       and r.partner_user_id is distinct from pe.user_id
       and ((r.marina_organization_id is not null and r.marina_organization_id = any (pe.orgs))
         or (r.marina_organization_id is null and r.marina_user_id = pe.user_id))
       and not (r.partner_organization_id is not null and r.partner_organization_id = any (pe.orgs))
       and r.created_at > pe.since
  ),
  req_agg as (
    select q.user_id,
           max(q.n)::integer as n,
           coalesce(jsonb_agg(jsonb_build_object(
             'name', coalesce(nullif(btrim(concat_ws(' ', sp.first_name, sp.last_name)), ''), 'A member'),
             'company', coalesce(so.name, ''),
             'text', left(regexp_replace(btrim(coalesce(q.message, '')), '\s+', ' ', 'g'), 140),
             'at', q.created_at) order by q.created_at desc) filter (where q.rn <= 5), '[]'::jsonb) as requests
      from reqs q
      left join public.profiles sp on sp.user_id = q.partner_user_id
      left join public.organizations so on so.id = q.partner_organization_id
     group by q.user_id
  )
  select pe.user_id, pe.email, pe.first_name, wk.w, pe.since, now(),
         coalesce(ma.n, 0), coalesce(ma.previews, '[]'::jsonb),
         coalesce(ra.n, 0), coalesce(ra.requests, '[]'::jsonb)
    from people pe
   cross join wk
    left join msg_agg ma on ma.user_id = pe.user_id
    left join req_agg ra on ra.user_id = pe.user_id
   where coalesce(ma.n, 0) + coalesce(ra.n, 0) > 0
     and coalesce(pe.email, '') <> ''
   order by pe.user_id
   limit greatest(coalesce(p_limit, 500), 0);
$function$;

-- Is it digest time? Fridays, 10:00 to 10:59 in Monaco (Victor's "10:00 Monaco"),
-- summer and winter time alike. pg_cron counts in UTC, so the job runs at 08:00,
-- 08:30, 09:00 and 09:30 UTC on Fridays and only the two runs that fall at 10:00 and
-- 10:30 in Monaco go ahead: the 10:30 one sends what the first left (time budget,
-- a refused send); digest_log keeps it from sending anything twice.
CREATE OR REPLACE FUNCTION public.msg_digest_due(p_at timestamptz DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select extract(isodow from (p_at at time zone 'Europe/Monaco')) = 5
     and extract(hour from (p_at at time zone 'Europe/Monaco')) = 10;
$function$;

-- pg_cron job "messages-digest-friday" (scheduled by the LAUNCH migration
-- 20261009190001_messages_digest_cron.sql, not here): POST messages-digest with the
-- Vault service_role_key (as invoke_send_profile_reminders), at digest time only
-- (p_force skips that check, for a run by hand). Exits quietly without secrets.
CREATE OR REPLACE FUNCTION public.invoke_messages_digest(p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  IF NOT coalesce(p_force, false) AND NOT public.msg_digest_due(now()) THEN
    RETURN;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'invoke_messages_digest: vault read failed: %', SQLERRM;
    RETURN;
  END;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'invoke_messages_digest: vault secrets not configured; skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/messages-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$function$;

COMMENT ON FUNCTION public.invoke_messages_digest(boolean) IS
  'pg_cron job messages-digest-friday: POST messages-digest with the Vault service_role_key, Fridays 10:00-10:59 Monaco only unless p_force. Not callable by anon/authenticated. 2026-10-09.';

-- ─── 10. Function privileges ───────────────────────────────────────────────
-- Internal (any user id as argument, or e-mail addresses): service role only.
REVOKE ALL ON FUNCTION public.msg_user_org_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.msg_side(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.msg_unread_items(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.msg_report_excerpt(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.msg_digest_batch(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoke_messages_digest(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.msg_digest_due(timestamptz) FROM PUBLIC, anon, authenticated;
-- (The four trigger functions keep their default privileges: a function returning
-- trigger cannot be called directly, and the triggers fire for the clients' writes.)
GRANT EXECUTE ON FUNCTION public.msg_user_org_ids(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.msg_side(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.msg_unread_items(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.msg_report_excerpt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.msg_digest_batch(date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_messages_digest(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.msg_digest_due(timestamptz) TO service_role;

-- Signed-in members (each checks the caller itself; used by RLS policies or the client).
REVOKE ALL ON FUNCTION public.msg_can_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_can_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_my_side_org(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_can_write(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_orgs_sectors_match(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_pair_open_request(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_unread_count() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_conversations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_thread(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_mark_read(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.msg_can_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_can_report(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_my_side_org(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_can_write(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_orgs_sectors_match(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_pair_open_request(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_unread_count() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_conversations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_thread(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_mark_read(uuid, timestamptz) TO authenticated, service_role;

-- ─── 11. The Friday job: NOT here ──────────────────────────────────────────
-- It is scheduled by 20261009190001_messages_digest_cron.sql, applied only on the
-- day the refonte replaces the old site on smartmarinaconnect.com (the old site has
-- no Messages screen, still e-mails each request, and ignores /?open=inbox).

-- ─── B2. The launch-day migration, verbatim ─────────────────────────────────
-- LAUNCH-DAY migration: the Friday messages digest (company messaging, Victor's
-- decisions of 9 Oct 2026). Needs 20261009190000_company_messaging.sql first.
--
-- APPLY IT ONLY ON THE DAY THE REFONTE REPLACES THE OLD SITE on
-- smartmarinaconnect.com, together with the deploy of the messages-digest edge
-- function (verify_jwt = true). Before that day the live site has no Messages
-- screen, still e-mails each request as it arrives (partner_request_received) and
-- ignores /?open=inbox: a digest would announce those requests a second time and
-- send people to a button that does nothing.
--
-- What it does: pg_cron job "messages-digest-friday" at 08:00, 08:30, 09:00 and
-- 09:30 UTC on Fridays. public.invoke_messages_digest() goes ahead only between
-- 10:00 and 10:59 in Monaco (msg_digest_due), so two runs a Friday reach the edge
-- function, at 10:00 and 10:30 Monaco time in summer and in winter alike. The
-- second sends what the first left (its time budget, a send Resend refused);
-- digest_log stops anything from being sent twice.
--
-- Check after applying:
--   select jobname, schedule, command from cron.job where jobname = 'messages-digest-friday';
--     -> '0,30 8,9 * * 5', 'SELECT public.invoke_messages_digest();'
-- UNDO: supabase/migrations/down/20261009190001_messages_digest_cron.down.sql

SELECT cron.schedule(
  'messages-digest-friday',
  '0,30 8,9 * * 5',
  $cmd$SELECT public.invoke_messages_digest();$cmd$
);

-- ─── C. Report helper ────────────────────────────────────────────────────────
create function pg_temp.dr(p_id text, p_ok boolean, p_detail text)
 returns text language sql immutable as
$f$ select format(E'\n%s %s %s', case when p_ok then 'PASS' else 'FAIL' end, p_id, left(coalesce(p_detail, ''), 400)) $f$;

-- ─── D. Checks ───────────────────────────────────────────────────────────────
do $dryrun$
declare
  results text := '';
  n_pass integer := 0;
  n_fail integer := 0;
  v_ok boolean;
  v_err text; v_state text; v_hint text;
  v_s uuid; v_os uuid; v_c uuid; v_om uuid; v_r uuid; v_r2 uuid; v_on uuid; v_n uuid; v_x uuid; v_u uuid; v_m uuid;
  v_os_name text; v_om_name text;
  v_r_pref boolean; v_s_pref boolean; v_n_pref boolean;
  v_req uuid; v_req2 uuid; v_msg uuid; v_rep uuid; v_ts timestamptz;
  v_status text; v_auto boolean; v_at timestamptz; v_by uuid; v_origin text;
  v_i integer; v_j integer; v_k integer;
  v_t text; v_t2 text; v_b boolean; v_b2 boolean; v_u1 uuid; v_u2 uuid;
  v_rec record;
  v_json jsonb;
  v_ids uuid[];
  c_first constant text := 'Dry run first message: hello from our team.';
  c_reply constant text := 'Dry run reply: thanks, glad to connect.';
begin
  if to_regclass('pg_temp._dr_before') is null then
    raise exception 'DRYRUN FAIL before-snapshot missing: the statements did not run in one transaction; check whether the migration was committed';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  /* ═══════════════════════ structural checks ═══════════════════════ */

  select count(*) into v_i from information_schema.columns
   where table_schema = 'public' and table_name = 'partner_requests' and column_name in ('origin', 'auto_connected');
  v_ok := v_i = 2;
  results := results || pg_temp.dr('S01', v_ok, format('partner_requests has origin and auto_connected (%s of 2)', v_i));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  select string_agg(tgname, ',' order by tgname) into v_t from pg_trigger
   where tgrelid = 'public.partner_requests'::regclass and not tgisinternal;
  v_ok := v_t = 'trg_partner_requests_before_insert,trg_partner_requests_before_update,trg_partner_requests_msg_insert,trg_partner_requests_msg_update,trg_partner_requests_updated_at';
  results := results || pg_temp.dr('S02', v_ok, 'partner_requests triggers, in firing order: ' || coalesce(v_t, 'none'));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- Policies on partner_requests: exactly one added, none changed.
  select count(*) filter (where b.k is null), count(*) filter (where a.k is null), count(*) filter (where a.v <> b.v),
         string_agg(coalesce(a.k, b.k), ', ') filter (where a.k is null or b.k is null or a.v <> b.v)
    into v_i, v_j, v_k, v_t
    from (select 'policy ' || policyname as k,
                 permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as v
            from pg_policies where schemaname = 'public' and tablename = 'partner_requests') a
    full join (select k, v from _dr_before where k like 'policy %') b on a.k = b.k;
  v_ok := v_i = 1 and v_j = 0 and v_k = 0 and v_t = 'policy partner_requests_select_sender_org';
  results := results || pg_temp.dr('S03', v_ok, format('partner_requests policies: %s added, %s removed, %s changed (%s)', v_i, v_j, v_k, v_t));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- Rows untouched.
  select count(*) into v_i
    from (select status::text as s, count(*)::text as n from public.partner_requests group by status) a
    full join (select substr(k, 7) as s, v as n from _dr_before where k like 'count %') b on a.s = b.s
   where a.n is distinct from b.n;
  select count(*) filter (where auto_connected), count(*) filter (where origin is not null) into v_j, v_k from public.partner_requests;
  v_ok := v_i = 0 and v_j = 0 and v_k = 0;
  results := results || pg_temp.dr('S04', v_ok, format('existing requests unchanged: %s status counts differ, %s auto_connected, %s with origin', v_i, v_j, v_k));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- Cron: one job added, the others unchanged.
  select count(*) filter (where b.k is null), count(*) filter (where a.k is null or a.v <> b.v)
    into v_i, v_j
    from (select 'cron ' || jobname as k, schedule || '|' || command as v from cron.job) a
    full join (select k, v from _dr_before where k like 'cron %') b on a.k = b.k;
  select schedule || ' | ' || command into v_t from cron.job where jobname = 'messages-digest-friday';
  v_ok := v_i = 1 and v_j = 0 and v_t = '0,30 8,9 * * 5 | SELECT public.invoke_messages_digest();';
  results := results || pg_temp.dr('S05', v_ok, format('cron (launch file): %s added, %s other changed; messages-digest-friday = %s', v_i, v_j, coalesce(v_t, 'missing')));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  select count(*) into v_i from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('conversation_messages', 'conversation_reads', 'conversation_reports', 'digest_log')
     and c.relrowsecurity;
  v_ok := v_i = 4;
  results := results || pg_temp.dr('S06', v_ok, format('RLS on the 4 new tables (%s of 4)', v_i));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- Privileges: internal functions closed to clients, member RPCs open to signed-in only.
  select string_agg(x.f || ' ' || x.r || '=' || has_function_privilege(x.r, x.f, 'execute')::text, '; ')
           filter (where has_function_privilege(x.r, x.f, 'execute') <> x.want)
    into v_t
    from (values
      ('public.msg_digest_batch(date, integer)', 'authenticated', false),
      ('public.msg_digest_batch(date, integer)', 'anon', false),
      ('public.msg_digest_batch(date, integer)', 'service_role', true),
      ('public.msg_unread_items(uuid, timestamp with time zone)', 'authenticated', false),
      ('public.msg_user_org_ids(uuid)', 'authenticated', false),
      ('public.msg_side(uuid, uuid)', 'authenticated', false),
      ('public.msg_report_excerpt(uuid)', 'authenticated', false),
      ('public.invoke_messages_digest(boolean)', 'authenticated', false),
      ('public.invoke_messages_digest(boolean)', 'anon', false),
      ('public.msg_digest_due(timestamp with time zone)', 'authenticated', false),
      ('public.msg_conversations()', 'anon', false),
      ('public.msg_thread(uuid)', 'anon', false),
      ('public.msg_unread_count()', 'anon', false),
      ('public.msg_mark_read(uuid, timestamp with time zone)', 'anon', false),
      ('public.msg_pair_open_request(uuid, uuid)', 'anon', false),
      ('public.msg_can_report(uuid)', 'anon', false),
      ('public.msg_conversations()', 'authenticated', true),
      ('public.msg_thread(uuid)', 'authenticated', true),
      ('public.msg_mark_read(uuid, timestamp with time zone)', 'authenticated', true),
      ('public.msg_can_report(uuid)', 'authenticated', true),
      ('public.msg_unread_count()', 'authenticated', true),
      ('public.msg_orgs_sectors_match(uuid, uuid)', 'authenticated', true),
      ('public.msg_pair_open_request(uuid, uuid)', 'authenticated', true),
      ('public.msg_can_access(uuid)', 'authenticated', true),
      ('public.msg_can_write(uuid, uuid)', 'authenticated', true)
    ) as x(f, r, want);
  v_ok := v_t is null;
  results := results || pg_temp.dr('S07', v_ok, 'function privileges' || coalesce(': wrong ' || v_t, ' as intended'));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  select string_agg(x.t || ' ' || x.r || ' ' || x.p, '; ') filter (where has_table_privilege(x.r, x.t, x.p) <> x.want)
    into v_t
    from (values
      ('public.conversation_messages', 'anon', 'select', false),
      ('public.conversation_messages', 'authenticated', 'select', true),
      ('public.conversation_messages', 'authenticated', 'insert', true),
      ('public.conversation_messages', 'authenticated', 'update', false),
      ('public.conversation_messages', 'authenticated', 'delete', false),
      ('public.conversation_reads', 'authenticated', 'insert', false),
      ('public.conversation_reads', 'authenticated', 'update', false),
      ('public.conversation_reports', 'anon', 'select', false),
      ('public.conversation_reports', 'authenticated', 'delete', false),
      ('public.digest_log', 'authenticated', 'select', false),
      ('public.digest_log', 'anon', 'select', false),
      ('public.digest_log', 'service_role', 'insert', true)
    ) as x(t, r, p, want);
  v_ok := v_t is null;
  results := results || pg_temp.dr('S08', v_ok, 'table privileges' || coalesce(': wrong ' || v_t, ' as intended'));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S10: digest time = Fridays 10:00-10:59 in Monaco, summer (UTC+2) and winter (UTC+1) alike.
  select string_agg(x.ts::text || '=' || public.msg_digest_due(x.ts)::text, '; ')
           filter (where public.msg_digest_due(x.ts) <> x.want)
    into v_t
    from (values
      ('2026-10-16 08:00:00+00'::timestamptz, true),   -- Friday, 10:00 Monaco (summer time)
      ('2026-10-16 08:30:00+00'::timestamptz, true),   -- the 10:30 catch-up
      ('2026-10-16 09:00:00+00'::timestamptz, false),  -- 11:00 Monaco
      ('2026-10-30 08:30:00+00'::timestamptz, false),  -- Friday after 25 Oct: 09:30 Monaco
      ('2026-10-30 09:00:00+00'::timestamptz, true),   -- 10:00 Monaco (winter time)
      ('2026-10-30 09:30:00+00'::timestamptz, true),
      ('2026-10-15 08:00:00+00'::timestamptz, false)   -- a Thursday
    ) as x(ts, want);
  v_ok := v_t is null;
  results := results || pg_temp.dr('S10', v_ok, 'digest time (msg_digest_due)' || coalesce(': wrong ' || v_t, ': Fridays 10:00-10:59 Monaco, summer and winter'));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S11: a report outlives its request (SET NULL, nullable); digest_log keeps covered_until.
  select string_agg(x, '; ') into v_t from (
    select 'reports fk ' || coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                                        where c.conrelid = 'public.conversation_reports'::regclass and c.contype = 'f'
                                          and c.confrelid = 'public.partner_requests'::regclass), 'missing') as x
    union all
    select 'reports nullable ' || coalesce((select is_nullable from information_schema.columns
                                              where table_schema = 'public' and table_name = 'conversation_reports'
                                                and column_name = 'partner_request_id'), 'missing')
    union all
    select 'digest_log covered_until ' || coalesce((select data_type from information_schema.columns
                                                      where table_schema = 'public' and table_name = 'digest_log'
                                                        and column_name = 'covered_until'), 'missing')
  ) q;
  v_ok := coalesce(v_t like '%ON DELETE SET NULL%' and v_t like '%reports nullable YES%' and v_t like '%covered_until timestamp with time zone%', false);
  results := results || pg_temp.dr('S11', v_ok, coalesce(v_t, 'nothing found'));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  /* ═══════════════════════ callers (read-only lookups) ═══════════════════════ */

  -- S and OS: a service-side company with a matching marina (OM) that has a verified member.
  select m.user_id, o.id, o.name into v_s, v_os, v_os_name
    from public.organization_members m
    join public.profiles p on p.user_id = m.user_id and p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator')
    join public.organizations o on o.id = m.organization_id and o.access_status = 'verified' and o.organization_type in ('partner', 'media_partner')
   where exists (
           select 1
             from public.organizations om
             join public.organization_members mm on mm.organization_id = om.id
             join public.profiles pp on pp.user_id = mm.user_id and pp.access_status = 'verified' and pp.persona::text not in ('admin', 'moderator')
            where om.access_status = 'verified' and om.organization_type = 'marina'
              and public.msg_orgs_sectors_match(o.id, om.id)
              and public.msg_pair_open_request(o.id, om.id) is null
              and not exists (select 1 from public.organization_members z where z.organization_id = o.id and z.user_id = mm.user_id))
     and (select count(*) from public.organization_members z where z.user_id = m.user_id) = 1
   order by (select count(*) from public.organization_members x
               join public.profiles px on px.user_id = x.user_id and px.access_status = 'verified'
              where x.organization_id = o.id) desc,
            m.joined_at, m.user_id
   limit 1;

  select m.user_id into v_c
    from public.organization_members m
    join public.profiles p on p.user_id = m.user_id and p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator')
   where m.organization_id = v_os and m.user_id <> v_s
     and (select count(*) from public.organization_members z where z.user_id = m.user_id) = 1
   order by m.joined_at, m.user_id limit 1;

  select om.id, om.name into v_om, v_om_name
    from public.organizations om
   where om.access_status = 'verified' and om.organization_type = 'marina'
     and public.msg_orgs_sectors_match(v_os, om.id)
     and public.msg_pair_open_request(v_os, om.id) is null
     and exists (select 1 from public.organization_members mm
                   join public.profiles pp on pp.user_id = mm.user_id and pp.access_status = 'verified' and pp.persona::text not in ('admin', 'moderator')
                  where mm.organization_id = om.id
                    and (select count(*) from public.organization_members z where z.user_id = mm.user_id) = 1)
   order by (select count(*) from public.organization_members x
               join public.profiles px on px.user_id = x.user_id and px.access_status = 'verified'
              where x.organization_id = om.id) desc, om.id
   limit 1;

  select mm.user_id into v_r
    from public.organization_members mm
    join public.profiles pp on pp.user_id = mm.user_id and pp.access_status = 'verified' and pp.persona::text not in ('admin', 'moderator')
   where mm.organization_id = v_om
     and (select count(*) from public.organization_members z where z.user_id = mm.user_id) = 1
   order by mm.joined_at, mm.user_id limit 1;

  select mm.user_id into v_r2
    from public.organization_members mm
    join public.profiles pp on pp.user_id = mm.user_id and pp.access_status = 'verified' and pp.persona::text not in ('admin', 'moderator')
   where mm.organization_id = v_om and mm.user_id <> v_r
     and (select count(*) from public.organization_members z where z.user_id = mm.user_id) = 1
   order by mm.joined_at, mm.user_id limit 1;

  select o.id, mm.user_id into v_on, v_n
    from public.organizations o
    join public.organization_members mm on mm.organization_id = o.id
    join public.profiles pp on pp.user_id = mm.user_id and pp.access_status = 'verified' and pp.persona::text not in ('admin', 'moderator')
   where o.access_status = 'verified' and o.id not in (v_os, v_om)
     and not public.msg_orgs_sectors_match(v_os, o.id)
     and public.msg_pair_open_request(v_os, o.id) is null
     and (select count(*) from public.organization_members z where z.user_id = mm.user_id) = 1
   order by (o.organization_type = 'marina') desc, o.id, mm.joined_at, mm.user_id
   limit 1;

  select p.user_id into v_x
    from public.profiles p
   where p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator')
     and exists (select 1 from public.organization_members z where z.user_id = p.user_id)
     and not exists (select 1 from public.organization_members z
                      where z.user_id = p.user_id and z.organization_id in (v_os, v_om, v_on))
     and not exists (select 1 from public.organizations z where z.owner_user_id = p.user_id and z.id in (v_os, v_om, v_on))
   order by p.user_id limit 1;

  select p.user_id into v_u
    from public.profiles p
   where p.access_status <> 'verified'
     and exists (select 1 from public.organization_members z where z.user_id = p.user_id)
   order by p.user_id limit 1;

  select p.user_id into v_m
    from public.profiles p
   where p.access_status = 'verified' and p.persona::text = 'admin'
   order by p.user_id limit 1;

  select coalesce(notification_prefs ->> 'b2b', 'true') <> 'false' into v_r_pref from public.profiles where user_id = v_r;
  select coalesce(notification_prefs ->> 'b2b', 'true') <> 'false' into v_s_pref from public.profiles where user_id = v_s;
  select coalesce(notification_prefs ->> 'b2b', 'true') <> 'false' into v_n_pref from public.profiles where user_id = v_n;

  if v_s is null or v_os is null or v_om is null or v_r is null or v_on is null or v_n is null or v_x is null or v_m is null then
    raise exception 'DRYRUN %', format('LOOKUP FAILED: S=%s OS=%s OM=%s R=%s ON=%s N=%s X=%s M=%s', v_s is not null, v_os is not null,
      v_om is not null, v_r is not null, v_on is not null, v_n is not null, v_x is not null, v_m is not null) || results;
  end if;
  results := results || format(E'\nINFO callers found: colleague C %s, colleague R2 %s, unverified U %s, b2b e-mails on: R %s, S %s, N %s',
    v_c is not null, v_r2 is not null, v_u is not null, v_r_pref, v_s_pref, v_n_pref);

  v_ok := public.msg_orgs_sectors_match(v_os, v_om) and not public.msg_orgs_sectors_match(v_os, v_on)
          and not public.msg_orgs_sectors_match(v_os, v_os) and not public.msg_orgs_sectors_match(v_om, v_om);
  results := results || pg_temp.dr('S09', v_ok, 'sector rule: OS-OM match, OS-ON no match, same company never');
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  /* ═══════════════════════ A. sectors match: connected at once ═══════════════════════ */
  begin
    -- A01: S writes to OM (the text is trimmed; accepted at insert, no answerer).
    v_err := null; v_state := null; v_hint := null; v_req := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin, status, auto_connected)
      values (v_s, v_r, v_os, v_om, '   ' || c_first || '   ', 'message', 'pending', false)
      returning id, status::text, auto_connected, answered_at, answered_by_user_id into v_req, v_status, v_auto, v_at, v_by;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    perform set_config('request.jwt.claims', '', true);
    select message, origin into v_t, v_origin from public.partner_requests where id = v_req;
    v_ok := coalesce(v_err is null and v_status = 'accepted' and v_auto and v_at is not null and v_by is null
                     and v_t = c_first and v_origin = 'message', false);
    results := results || pg_temp.dr('A01', v_ok, 'S sends a first message to a matching company: accepted at once, auto_connected, no answerer, text trimmed. '
      || coalesce(v_err, format('status=%s auto=%s answered_at set=%s by=%s', v_status, v_auto, v_at is not null, v_by)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;
    if v_req is null then raise exception using errcode = 'DRY01', message = 'A stops: no request'; end if;

    -- A02: S's conversation list.
    v_err := null; v_u1 := null; v_t := null; v_u2 := null; v_i := null; v_b := null; v_b2 := null; v_t2 := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select c.other_org_id, c.my_side, c.my_org_id, c.unread_count, c.last_from_my_side, c.auto_connected, c.last_message_preview
        into v_u1, v_t, v_u2, v_i, v_b, v_b2, v_t2
        from public.msg_conversations() c where c.partner_request_id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_u1 = v_om and v_t = 'partner' and v_u2 = v_os
                     and v_i = 0 and v_b and v_b2 and v_t2 = c_first, false);
    results := results || pg_temp.dr('A02', v_ok, 'S sees the conversation with OM, nothing unread, last message is theirs. '
      || coalesce(v_err, format('other=OM %s side=%s unread=%s mine=%s auto=%s', v_u1 = v_om, v_t, v_i, v_b, v_b2)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A03: R (receiving company) has the first message unread.
    v_err := null; v_i := null; v_j := null; v_u1 := null; v_t := null; v_b := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_i := public.msg_unread_count();
      select c.unread_count, c.other_org_id, c.my_side, c.last_from_my_side
        into v_j, v_u1, v_t, v_b
        from public.msg_conversations() c where c.partner_request_id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_i >= 1 and v_j = 1 and v_u1 = v_os and v_t = 'marina' and not v_b, false);
    results := results || pg_temp.dr('A03', v_ok, 'R (OM) has the auto-connected first message unread. '
      || coalesce(v_err, format('total unread=%s thread unread=%s other=OS %s side=%s', v_i, v_j, v_u1 = v_os, v_t)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A04: R reads the thread: one message, the first, by S for OS.
    v_err := null; v_i := null; v_b := null; v_t := null; v_u1 := null; v_t2 := null; v_b2 := null; v_u2 := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_i from public.msg_thread(v_req);
      select t.is_first, t.body, t.author_user_id, t.author_org_name, t.from_my_side, t.id
        into v_b, v_t, v_u1, v_t2, v_b2, v_u2
        from public.msg_thread(v_req) t order by t.created_at limit 1;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_i = 1 and v_b and v_t = c_first and v_u1 = v_s
                     and v_t2 = v_os_name and not v_b2 and v_u2 = v_req, false);
    results := results || pg_temp.dr('A04', v_ok, 'R reads the thread: the first message, by S, company OS, not from R''s side. '
      || coalesce(v_err, format('rows=%s first=%s author=S %s company ok=%s mine=%s', v_i, v_b, v_u1 = v_s, v_t2 = v_os_name, v_b2)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A05: R replies, pretending to be S for OS, dated 2000: written as R for OM, now, trimmed.
    v_err := null; v_u1 := null; v_u2 := null; v_t := null; v_ts := null; v_msg := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_messages (partner_request_id, author_user_id, author_org_id, body, created_at)
      values (v_req, v_s, v_os, '  ' || c_reply || '  ', '2000-01-01')
      returning id, author_user_id, author_org_id, body, created_at into v_msg, v_u1, v_u2, v_t, v_ts;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_u1 = v_r and v_u2 = v_om and v_t = c_reply and v_ts = now(), false);
    results := results || pg_temp.dr('A05', v_ok, 'R replies (author, company and time forced to R / OM / now, text trimmed). '
      || coalesce(v_err, format('author=R %s company=OM %s dated now %s', v_u1 = v_r, v_u2 = v_om, v_ts = now())));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A06: S now has R's reply unread; the thread reads first message then the reply.
    v_err := null; v_i := null; v_b := null; v_t2 := null; v_t := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select c.unread_count, c.last_from_my_side, c.last_message_preview into v_i, v_b, v_t2
        from public.msg_conversations() c where c.partner_request_id = v_req;
      select string_agg(format('%s/%s/%s', t.is_first, t.from_my_side, t.author_org_name = v_om_name), ',' order by t.created_at)
        into v_t from public.msg_thread(v_req) t;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_i = 1 and not v_b and v_t2 = c_reply
                     and v_t = 'true/true/false,false/false/true', false);
    results := results || pg_temp.dr('A06', v_ok, 'S has 1 unread (the reply); thread = [first, mine] then [reply, OM]. '
      || coalesce(v_err, format('unread=%s mine=%s thread=%s', v_i, v_b, v_t)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A07: digest (service side): R gets the first message, S gets the reply.
    select count(*) filter (where d.user_id = v_r and d.message_count = 1 and d.previews -> 0 ->> 'company' = v_os_name
                                  and d.previews -> 0 ->> 'text' = left(c_first, 140)),
           count(*) filter (where d.user_id = v_s and d.message_count = 1 and d.previews -> 0 ->> 'company' = v_om_name
                                  and d.previews -> 0 ->> 'text' = c_reply),
           count(*) filter (where d.user_id = v_x)
      into v_i, v_j, v_k
      from public.msg_digest_batch(null, 100000) d;
    v_ok := v_i = case when v_r_pref then 1 else 0 end and v_j = case when v_s_pref then 1 else 0 end and v_k = 0;
    results := results || pg_temp.dr('A07', v_ok, format('digest batch: R row with OS preview %s (expected %s), S row with OM preview %s (expected %s), outsider rows %s',
      v_i, v_r_pref::int, v_j, v_s_pref::int, v_k));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A07b: R turns "B2B" e-mails off: no digest for R (sub-block, undone at once).
    v_i := null; v_err := null;
    begin
      update public.profiles
         set notification_prefs = coalesce(notification_prefs, '{}'::jsonb) || '{"b2b": false}'::jsonb
       where user_id = v_r;
      select count(*) into v_i from public.msg_digest_batch(null, 100000) d where d.user_id = v_r;
      raise exception using errcode = 'DRY02', message = 'undo A07b';
    exception
      when sqlstate 'DRY02' then null;
      when others then get stacked diagnostics v_err = message_text;
    end;
    v_ok := coalesce(v_err is null and v_i = 0, false);
    results := results || pg_temp.dr('A07b', v_ok, 'with b2b e-mails off, R gets no digest: ' || coalesce(v_err, format('%s rows', v_i)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A08: a digest_log row for this week takes R out of the batch (no second send).
    insert into public.digest_log (user_id, kind, week_start, status, sent_at)
    values (v_r, 'messages', (date_trunc('week', now() at time zone 'UTC'))::date, 'sent', now());
    select count(*) into v_i from public.msg_digest_batch(null, 100000) d where d.user_id = v_r;
    v_ok := v_i = 0;
    results := results || pg_temp.dr('A08', v_ok, format('after a send logged this week, R is not in the batch again (%s rows)', v_i));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A08b: the next digest starts where the last one's data ended (covered_until, the
    -- batch's as_of), not when it was sent: S's last digest (last week) covered up to a
    -- minute ago and went out now; the reply written in between is still in S's next one.
    v_i := null; v_ts := null; v_at := null; v_err := null;
    begin
      insert into public.digest_log (user_id, kind, week_start, status, sent_at, covered_until)
      values (v_s, 'messages', (date_trunc('week', now() at time zone 'UTC'))::date - 7, 'sent', now(), now() - interval '1 minute');
      select d.message_count, d.since, d.as_of into v_i, v_ts, v_at from public.msg_digest_batch(null, 100000) d where d.user_id = v_s;
      raise exception using errcode = 'DRY02', message = 'undo A08b';
    exception
      when sqlstate 'DRY02' then null;
      when others then get stacked diagnostics v_err = message_text;
    end;
    v_ok := coalesce(v_err is null and case when v_s_pref
                       then v_i = 1 and v_ts = now() - interval '1 minute' and v_at = now()
                       else v_i is null end, false);
    results := results || pg_temp.dr('A08b', v_ok, 'S''s next digest starts at the last one''s covered_until (the reply is in it), as_of = the batch time. '
      || coalesce(v_err, format('messages=%s since=covered_until %s as_of=now %s (b2b on: %s)', v_i, v_ts = now() - interval '1 minute', v_at = now(), v_s_pref)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A08c: a 'sending' claim left by a run that died (over 15 minutes old) does not
    -- keep S out of this week's digest; a fresh one (a run in progress) does.
    v_i := null; v_j := null; v_err := null;
    begin
      insert into public.digest_log (user_id, kind, week_start, status, created_at)
      values (v_s, 'messages', (date_trunc('week', now() at time zone 'UTC'))::date, 'sending', now() - interval '20 minutes');
      select count(*) into v_i from public.msg_digest_batch(null, 100000) d where d.user_id = v_s;
      update public.digest_log set created_at = now()
       where user_id = v_s and kind = 'messages' and week_start = (date_trunc('week', now() at time zone 'UTC'))::date;
      select count(*) into v_j from public.msg_digest_batch(null, 100000) d where d.user_id = v_s;
      raise exception using errcode = 'DRY02', message = 'undo A08c';
    exception
      when sqlstate 'DRY02' then null;
      when others then get stacked diagnostics v_err = message_text;
    end;
    v_ok := coalesce(v_err is null and v_i = case when v_s_pref then 1 else 0 end and v_j = 0, false);
    results := results || pg_temp.dr('A08c', v_ok, 'stale claim (20 min) -> S still in the batch; fresh claim -> S left out. '
      || coalesce(v_err, format('stale: %s row(s) (expected %s), fresh: %s', v_i, v_s_pref::int, v_j)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A09: members cannot run the digest batch nor read digest_log.
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform count(*) from public.msg_digest_batch(null, 10);
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_t := v_state;
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform count(*) from public.digest_log;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := v_t = '42501' and v_state = '42501';
    results := results || pg_temp.dr('A09', v_ok, format('member: msg_digest_batch refused (%s), digest_log refused (%s)', v_t, v_state));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A10: marking read clears the unread counts (S: the reply; R: the first message).
    v_err := null; v_i := null; v_j := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.msg_mark_read(v_req);
      select c.unread_count into v_i from public.msg_conversations() c where c.partner_request_id = v_req;
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      perform public.msg_mark_read(v_req);
      select c.unread_count into v_j from public.msg_conversations() c where c.partner_request_id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    select count(*) into v_k from public.conversation_reads where partner_request_id = v_req and user_id in (v_s, v_r);
    v_ok := coalesce(v_err is null and v_i = 0 and v_j = 0 and v_k = 2, false);
    results := results || pg_temp.dr('A10', v_ok, 'msg_mark_read: S and R back to 0 unread. '
      || coalesce(v_err, format('S=%s R=%s read rows=%s', v_i, v_j, v_k)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A11-A15: an outsider X sees and writes nothing; anon has no access at all.
    v_err := null; v_i := null; v_j := null; v_k := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_i from public.msg_thread(v_req);
      select count(*) into v_j from public.conversation_messages where partner_request_id = v_req;
      select count(*) into v_k from public.msg_conversations() c where c.partner_request_id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_i = 0 and v_j = 0 and v_k = 0, false);
    results := results || pg_temp.dr('A11', v_ok, 'X reads nothing (thread, table, list). ' || coalesce(v_err, format('%s/%s/%s rows', v_i, v_j, v_k)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_messages (partner_request_id, body) values (v_req, 'Dry run intrusion');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := v_state = '42501';
    results := results || pg_temp.dr('A12', v_ok, 'X cannot write in the conversation: ' || coalesce(v_state || ' ' || v_err, 'ALLOWED'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.msg_mark_read(v_req);
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_t := v_state;
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_reports (partner_request_id, reason) values (v_req, 'Dry run report by an outsider');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := v_t = '42501' and v_state = '42501';
    results := results || pg_temp.dr('A13', v_ok, format('X cannot mark read (%s) nor report (%s)', v_t, v_state));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      set local role anon;
      perform count(*) from public.conversation_messages;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_t := v_state;
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      set local role anon;
      perform count(*) from public.msg_conversations();
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := v_t = '42501' and v_state = '42501';
    results := results || pg_temp.dr('A14', v_ok, format('anon: table refused (%s), msg_conversations refused (%s)', v_t, v_state));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A15: a colleague of S (same company) reads the request and the thread, and writes as OS.
    if v_c is null then
      results := results || E'\nINFO A15 no second verified member in OS: colleague case not run';
    else
      v_err := null; v_i := null; v_j := null; v_u2 := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*) into v_i from public.partner_requests where id = v_req;
        select count(*) into v_j from public.msg_thread(v_req);
        insert into public.conversation_messages (partner_request_id, body) values (v_req, 'Dry run: a colleague of the sender joins in.')
        returning author_org_id into v_u2;
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      end;
      v_ok := coalesce(v_err is null and v_i = 1 and v_j = 2 and v_u2 = v_os, false);
      results := results || pg_temp.dr('A15', v_ok, 'C (colleague of S) reads the request and thread and writes as OS. '
        || coalesce(v_err, format('request rows=%s thread rows=%s company=OS %s', v_i, v_j, v_u2 = v_os)));
      n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;
    end if;

    -- A16: a colleague of R: the first message (auto) and C's message unread; R's reply (own side) not.
    if v_r2 is null then
      results := results || E'\nINFO A16 no second verified member in OM: receiving colleague case not run';
    else
      v_err := null; v_i := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_r2, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select c.unread_count into v_i from public.msg_conversations() c where c.partner_request_id = v_req;
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      end;
      v_ok := coalesce(v_err is null and v_i = 1 + case when v_c is null then 0 else 1 end, false);
      results := results || pg_temp.dr('A16', v_ok, 'R2 (colleague of R): unread = first message + other side''s messages, not R''s reply. '
        || coalesce(v_err, format('unread=%s', v_i)));
      n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;
    end if;

    -- A17: one conversation per pair of companies, both ways.
    v_err := null; v_state := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin)
      values (v_s, v_r, v_os, v_om, 'Dry run: second first message', 'message');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_t := v_hint;
    v_err := null; v_state := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin)
      values (v_r, v_s, v_om, v_os, 'Dry run: the other way round', 'message');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_ok := v_t = 'already_connected' and v_hint = 'already_connected';
    results := results || pg_temp.dr('A17', v_ok, format('already in touch: S again -> %s, R towards OS -> %s', v_t, v_hint));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A18: R reports the conversation: excerpt kept for M3, reporter forced to R / OM.
    v_err := null; v_t := null; v_u1 := null; v_u2 := null; v_t2 := null; v_i := null; v_j := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_reports (partner_request_id, reason, reporter_user_id, status, handled_at)
      values (v_req, '  Dry run: this looks like spam.  ', v_s, 'closed', now())
      returning excerpt, reporter_user_id, reporter_org_id, status into v_t, v_u1, v_u2, v_t2;
      select count(*) into v_i from public.conversation_reports where partner_request_id = v_req;
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      select count(*) into v_j from public.conversation_reports where partner_request_id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_u1 = v_r and v_u2 = v_om and v_t2 = 'open' and strpos(v_t, c_first) > 0
                     and strpos(v_t, c_reply) > 0 and v_i = 1 and v_j = 0, false);
    results := results || pg_temp.dr('A18', v_ok, 'R reports: reporter R/OM, open, excerpt has both messages; R reads it, S does not. '
      || coalesce(v_err, format('reporter=R %s org=OM %s status=%s excerpt ok=%s R sees=%s S sees=%s',
           v_u1 = v_r, v_u2 = v_om, v_t2, strpos(coalesce(v_t, ''), c_first) > 0, v_i, v_j)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A18b: once M3 has closed the conversation (status moved away from accepted), a
    -- report carries the first message only, not the conversation (sub-block, undone).
    v_err := null; v_t := null;
    begin
      update public.partner_requests set status = 'withdrawn' where id = v_req;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into public.conversation_reports (partner_request_id, reason)
        values (v_req, 'Dry run: report after M3 closed it')
        returning excerpt into v_t;
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text;
      end;
      raise exception using errcode = 'DRY02', message = 'undo A18b';
    exception when sqlstate 'DRY02' then null;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and strpos(v_t, c_first) > 0 and strpos(v_t, c_reply) = 0, false);
    results := results || pg_temp.dr('A18b', v_ok, 'report on a conversation M3 closed: excerpt = first message only. '
      || coalesce(v_err, format('first=%s reply=%s', strpos(coalesce(v_t, ''), c_first) > 0, strpos(coalesce(v_t, ''), c_reply) > 0)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A19: M3 (verified admin) reads and closes the report; the reporter cannot close it.
    v_err := null; v_i := null; v_u1 := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.conversation_reports set status = 'closed' where partner_request_id = v_req;
      get diagnostics v_j = row_count;
      perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
      select count(*) into v_i from public.conversation_reports where partner_request_id = v_req;
      update public.conversation_reports set status = 'closed', staff_note = 'Dry run: checked.'
       where partner_request_id = v_req
      returning handled_by, reason into v_u1, v_t;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_j = 0 and v_i = 1 and v_u1 = v_m and v_t = 'Dry run: this looks like spam.', false);
    results := results || pg_temp.dr('A19', v_ok, 'reporter cannot close; admin reads and closes it (handled_by = admin, reason kept). '
      || coalesce(v_err, format('reporter updated=%s admin sees=%s handled_by=admin %s reason kept=%s', v_j, v_i, v_u1 = v_m, v_t = 'Dry run: this looks like spam.')));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A20: members cannot edit or delete messages, nor write read markers directly.
    v_t := '';
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.conversation_messages set body = 'edited' where partner_request_id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_t := v_t || 'update ' || coalesce(v_state, 'ALLOWED');
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      delete from public.conversation_messages where partner_request_id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_t := v_t || ', delete ' || coalesce(v_state, 'ALLOWED');
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_reads (partner_request_id, user_id, last_read_at) values (v_req, v_r, '2100-01-01');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_t := v_t || ', reads insert ' || coalesce(v_state, 'ALLOWED');
    v_ok := v_t = 'update 42501, delete 42501, reads insert 42501';
    results := results || pg_temp.dr('A20', v_ok, v_t);
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A21: a self-service update cannot change origin / auto_connected (R may update the row).
    v_err := null; v_origin := null; v_auto := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set origin = null, auto_connected = false where id = v_req
      returning origin, auto_connected into v_origin, v_auto;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_origin = 'message' and v_auto, false);
    results := results || pg_temp.dr('A21', v_ok, 'origin / auto_connected unchanged by a member update. '
      || coalesce(v_err, format('origin=%s auto=%s', v_origin, v_auto)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A21b: the receiving company cannot rewrite the first message of the conversation.
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set message = 'Dry run: rewritten by the other side' where id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    select message into v_t from public.partner_requests where id = v_req;
    v_ok := coalesce(v_state = '42501' and v_err like '%Only the status%' and v_t = c_first, false);
    results := results || pg_temp.dr('A21b', v_ok, 'R edits the first message of an accepted conversation: '
      || coalesce(v_state || ' ' || v_err, 'ALLOWED') || format(', text unchanged=%s', v_t = c_first));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A22: the sender cannot withdraw the open conversation, nor set it back to pending.
    v_t := '';
    v_err := null; v_state := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set status = 'withdrawn' where id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_t := v_t || 'withdrawn ' || coalesce(v_hint, v_state, 'ALLOWED');
    v_err := null; v_state := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set status = 'pending' where id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_t := v_t || ', pending ' || coalesce(v_hint, v_state, 'ALLOWED');
    v_i := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_i from public.msg_thread(v_req);
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    select status::text into v_status from public.partner_requests where id = v_req;
    v_ok := v_t = 'withdrawn already_answered, pending already_answered' and v_status = 'accepted' and v_i >= 2;
    results := results || pg_temp.dr('A22', v_ok, format('sender changes an open conversation: %s; status still %s; R still reads %s messages', v_t, v_status, v_i));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A23: a report on one message keeps working when that message is deleted (FK set null passes the trigger).
    v_err := null; v_rep := null; v_u1 := null; v_i := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_reports (partner_request_id, message_id, reason)
      values (v_req, v_msg, 'Dry run: this one message.')
      returning id, message_id into v_rep, v_u1;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    perform set_config('request.jwt.claims', '', true);
    if v_rep is not null then
      delete from public.conversation_messages where id = v_msg;
      select count(*) filter (where message_id is null) into v_i from public.conversation_reports where id = v_rep;
    end if;
    v_ok := coalesce(v_err is null and v_u1 = v_msg and v_i = 1, false);
    results := results || pg_temp.dr('A23', v_ok, 'report on a message; the message deleted -> report kept with message_id null. '
      || coalesce(v_err, format('kept message=%s, set to null after delete=%s', v_u1 = v_msg, v_i)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A24: S leaves OS (sub-block, undone): S no longer reads, writes or reports in the
    -- conversation they started, and no longer sees it listed.
    v_err := null; v_i := null; v_j := null; v_k := null; v_t := null; v_t2 := null;
    begin
      delete from public.organization_members where user_id = v_s and organization_id = v_os;
      update public.organizations set owner_user_id = null where id = v_os and owner_user_id = v_s;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*) into v_i from public.msg_thread(v_req);
        select count(*) into v_j from public.msg_conversations() c where c.partner_request_id = v_req;
        v_k := public.msg_unread_count();
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text;
      end;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into public.conversation_messages (partner_request_id, body) values (v_req, 'Dry run: written after leaving');
        reset role;
        v_t := 'ALLOWED';
      exception when others then
        get stacked diagnostics v_t = returned_sqlstate;
      end;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into public.conversation_reports (partner_request_id, reason) values (v_req, 'Dry run: report after leaving');
        reset role;
        v_t2 := 'ALLOWED';
      exception when others then
        get stacked diagnostics v_t2 = returned_sqlstate;
      end;
      raise exception using errcode = 'DRY02', message = 'undo A24';
    exception when sqlstate 'DRY02' then null;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_i = 0 and v_j = 0 and v_k = 0 and v_t = '42501' and v_t2 = '42501', false);
    results := results || pg_temp.dr('A24', v_ok, 'S removed from OS: thread, list and unread empty, writing and reporting refused. '
      || coalesce(v_err, format('thread=%s list=%s unread=%s write=%s report=%s', v_i, v_j, v_k, v_t, v_t2)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A25: X joins OM now (sub-block, undone): X reads the conversation, and nothing
    -- written before they joined counts as unread for them.
    v_err := null; v_i := null; v_j := null;
    begin
      insert into public.organization_members (organization_id, user_id) values (v_om, v_x);
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*) into v_i from public.msg_thread(v_req);
        select c.unread_count into v_j from public.msg_conversations() c where c.partner_request_id = v_req;
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text;
      end;
      raise exception using errcode = 'DRY02', message = 'undo A25';
    exception when sqlstate 'DRY02' then null;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_i >= 1 and v_j = 0, false);
    results := results || pg_temp.dr('A25', v_ok, 'a new colleague (X joins OM) reads the thread with 0 unread. '
      || coalesce(v_err, format('thread rows=%s unread=%s', v_i, v_j)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A26: M3 suspends OM (sub-block, undone): R still reads the conversation, but
    -- writes no more.
    v_err := null; v_i := null; v_t := null;
    begin
      update public.organizations set access_status = 'suspended' where id = v_om;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*) into v_i from public.msg_thread(v_req);
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text;
      end;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into public.conversation_messages (partner_request_id, body) values (v_req, 'Dry run: written while suspended');
        reset role;
        v_t := 'ALLOWED';
      exception when others then
        get stacked diagnostics v_t = returned_sqlstate;
      end;
      raise exception using errcode = 'DRY02', message = 'undo A26';
    exception when sqlstate 'DRY02' then null;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_i >= 1 and v_t = '42501', false);
    results := results || pg_temp.dr('A26', v_ok, 'company suspended: R still reads, writing refused. '
      || coalesce(v_err, format('thread rows=%s write=%s', v_i, v_t)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- A27 (last: it deletes the request): the request goes (as when the account that
    -- sent or received it is deleted); the reports on it stay, with their excerpt.
    v_err := null; v_i := null; v_j := null;
    select array_agg(id) into v_ids from public.conversation_reports where partner_request_id = v_req;
    begin
      delete from public.partner_requests where id = v_req;
      select count(*) filter (where partner_request_id is null and excerpt is not null and strpos(excerpt, c_first) > 0)
        into v_i from public.conversation_reports where id = any (v_ids);
      select count(*) into v_j from public.conversation_messages where partner_request_id = v_req;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    v_ok := coalesce(v_err is null and cardinality(v_ids) >= 1 and v_i = cardinality(v_ids) and v_j = 0, false);
    results := results || pg_temp.dr('A27', v_ok, 'request deleted: its messages go, its reports stay (request null, excerpt kept). '
      || coalesce(v_err, format('reports kept %s of %s, messages left %s', v_i, cardinality(v_ids), v_j)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    raise exception using errcode = 'DRY01', message = 'scenario A finished';
  exception
    when sqlstate 'DRY01' then null;
    when others then
      get stacked diagnostics v_err = message_text;
      results := results || pg_temp.dr('A--', false, 'scenario A crashed: ' || v_err);
      n_fail := n_fail + 1;
  end;
  perform set_config('request.jwt.claims', '', true);

  /* ═══════════════════════ B. no sector match: the company decides ═══════════════════════ */
  begin
    v_err := null; v_req := null; v_status := null; v_auto := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin)
      values (v_s, v_n, v_os, v_on, c_first, 'message')
      returning id, status::text, auto_connected into v_req, v_status, v_auto;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_ok := coalesce(v_err is null and v_status = 'pending' and not v_auto, false);
    results := results || pg_temp.dr('B01', v_ok, 'S writes to a company without a sector match: pending. '
      || coalesce(v_err, format('status=%s auto=%s', v_status, v_auto)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;
    if v_req is null then raise exception using errcode = 'DRY01', message = 'B stops: no request'; end if;

    -- B01b: the sender cannot rewrite a first message still waiting (its 500 characters
    -- are checked when it is sent).
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set message = repeat('w', 900) where id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    select message into v_t from public.partner_requests where id = v_req;
    v_ok := coalesce(v_state = '42501' and v_err like '%Only the status%' and v_t = c_first, false);
    results := results || pg_temp.dr('B01b', v_ok, 'S edits the waiting first message: '
      || coalesce(v_state || ' ' || v_err, 'ALLOWED') || format(', text unchanged=%s', v_t = c_first));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;


    -- B02: N (receiving company) reads the request but no thread yet; X reads nothing.
    v_err := null; v_i := null; v_j := null; v_k := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_n, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_i from public.partner_requests where id = v_req;
      select count(*) into v_j from public.msg_thread(v_req);
      perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
      select count(*) into v_k from public.partner_requests where id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_i = 1 and v_j = 0 and v_k = 0, false);
    results := results || pg_temp.dr('B02', v_ok, 'pending: N reads the request, no thread; X reads nothing. '
      || coalesce(v_err, format('N request=%s thread=%s X=%s', v_i, v_j, v_k)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_n, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_messages (partner_request_id, body) values (v_req, 'Dry run: too early');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := v_state = '42501';
    results := results || pg_temp.dr('B03', v_ok, 'no message before the connection is accepted: ' || coalesce(v_state || ' ' || v_err, 'ALLOWED'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- B04: the sender's colleague sees the sent request (new policy).
    if v_c is null then
      results := results || E'\nINFO B04 no colleague of S: sender-company read not run';
    else
      v_err := null; v_i := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*) into v_i from public.partner_requests where id = v_req;
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      end;
      v_ok := coalesce(v_err is null and v_i = 1, false);
      results := results || pg_temp.dr('B04', v_ok, 'C (colleague of S) sees the request their company sent. ' || coalesce(v_err, format('rows=%s', v_i)));
      n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;
    end if;

    -- B05: digest: N's row lists the pending request (separately from messages).
    select count(*) into v_i
      from public.msg_digest_batch(null, 100000) d
     where d.user_id = v_n and d.request_count >= 1
       and exists (select 1 from jsonb_array_elements(d.requests) e where e ->> 'company' = v_os_name and e ->> 'text' = left(c_first, 140));
    v_ok := v_i = case when v_n_pref then 1 else 0 end;
    results := results || pg_temp.dr('B05', v_ok, format('digest batch: N row with the request from OS: %s (expected %s)', v_i, v_n_pref::int));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- B06: N accepts (existing rules: answered_by = N); not auto; the first message is NOT unread for N.
    v_err := null; v_status := null; v_by := null; v_auto := null; v_i := null; v_j := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_n, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set status = 'accepted' where id = v_req and status = 'pending'
      returning status::text, answered_by_user_id, auto_connected into v_status, v_by, v_auto;
      select c.unread_count into v_i from public.msg_conversations() c where c.partner_request_id = v_req;
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      select count(*) into v_j from public.msg_thread(v_req);
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_status = 'accepted' and v_by = v_n and not v_auto and v_i = 0 and v_j = 1, false);
    results := results || pg_temp.dr('B06', v_ok, 'N accepts by hand: answered by N, N has 0 unread, S reads the thread (first message). '
      || coalesce(v_err, format('status=%s by=N %s auto=%s N unread=%s S thread rows=%s', v_status, v_by = v_n, v_auto, v_i, v_j)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- B07: the existing first-answer-wins rule still holds.
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_n, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set status = 'rejected' where id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err like '%already been answered%', false);
    results := results || pg_temp.dr('B07', v_ok, 'a second answer is still refused: ' || coalesce(v_err, 'ALLOWED'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- B08: the sender cannot withdraw a conversation accepted by hand either.
    v_err := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set status = 'withdrawn' where id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_ok := v_hint = 'already_answered';
    results := results || pg_temp.dr('B08', v_ok, 'sender withdraws an accepted conversation: ' || coalesce(v_hint, v_err, 'ALLOWED'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- B09: a declined request cannot be put back in front of the company (old-client insert, N declines, S re-opens).
    v_err := null; v_hint := null; v_req2 := null; v_t := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, message) values (v_s, v_n, 'Dry run: to be declined')
      returning id into v_req2;
      perform set_config('request.jwt.claims', json_build_object('sub', v_n, 'role', 'authenticated')::text, true);
      update public.partner_requests set status = 'rejected' where id = v_req2;
      reset role;
    exception when others then
      get stacked diagnostics v_t = message_text;
    end;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set status = 'pending' where id = v_req2;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    select status::text into v_status from public.partner_requests where id = v_req2;
    v_ok := coalesce(v_t is null and v_hint = 'already_answered' and v_status = 'rejected', false);
    results := results || pg_temp.dr('B09', v_ok, 'sender re-opens a declined request: '
      || coalesce(v_t, coalesce(v_hint, v_err, 'ALLOWED') || ', status ' || coalesce(v_status, '?')));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- B10: a withdrawn request re-opened while the two companies already have a conversation is refused.
    v_err := null; v_hint := null; v_req2 := null; v_t := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, message) values (v_s, v_n, 'Dry run: to be withdrawn')
      returning id into v_req2;
      update public.partner_requests set status = 'withdrawn' where id = v_req2;
      reset role;
    exception when others then
      get stacked diagnostics v_t = message_text;
    end;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.partner_requests set status = 'pending' where id = v_req2;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_ok := coalesce(v_t is null and v_hint = 'already_connected', false);
    results := results || pg_temp.dr('B10', v_ok, 'withdraw then re-open beside an open conversation: '
      || coalesce(v_t, coalesce(v_hint, v_err, 'ALLOWED')));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    raise exception using errcode = 'DRY01', message = 'scenario B finished';
  exception
    when sqlstate 'DRY01' then null;
    when others then
      get stacked diagnostics v_err = message_text;
      results := results || pg_temp.dr('B--', false, 'scenario B crashed: ' || v_err);
      n_fail := n_fail + 1;
  end;
  perform set_config('request.jwt.claims', '', true);

  /* ═══════════════════════ C. rules of the first message, old client unchanged ═══════════════════════ */
  begin
    -- C01 / C02: 501 characters, blank.
    v_err := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin)
      values (v_s, v_n, v_os, v_on, repeat('x', 501), 'message');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_t := v_hint;
    v_err := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin)
      values (v_s, v_n, v_os, v_on, '    ', 'message');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_ok := v_t = 'message_length' and v_hint = 'message_length';
    results := results || pg_temp.dr('C01', v_ok, format('501 characters -> %s, blank -> %s', v_t, v_hint));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- C02: nobody writes in someone else's name (R as sender while signed in as S).
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, message)
      values (v_r, v_s, 'Dry run: forged sender');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_state = '42501' and v_err like '%your own name%', false);
    results := results || pg_temp.dr('C02', v_ok, 'a request in someone else''s name is refused: ' || coalesce(v_state || ' ' || v_err, 'ALLOWED'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- C03: own company.
    v_err := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin)
      values (v_s, coalesce(v_c, v_s), v_os, v_os, 'Dry run: to my own company', 'message');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_ok := v_hint = 'own_company';
    results := results || pg_temp.dr('C03', v_ok, 'a message to one''s own company is refused: ' || coalesce(v_hint, coalesce(v_err, 'ALLOWED')));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- C04: sender company not validated (OS set to pending inside this step only).
    v_err := null; v_hint := null;
    begin
      update public.organizations set access_status = 'pending' where id = v_os;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin)
        values (v_s, v_n, v_os, v_on, 'Dry run: from a company under review', 'message');
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
      end;
      raise exception using errcode = 'DRY02', message = 'undo C04';
    exception when sqlstate 'DRY02' then null;
    end;
    v_ok := v_hint = 'company_not_validated';
    results := results || pg_temp.dr('C04', v_ok, 'a company not validated by M3 cannot send: ' || coalesce(v_hint, coalesce(v_err, 'ALLOWED')));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- C05: OLD CLIENT inserts (no origin): no length, dedupe or auto-connect rules;
    -- the status and auto_connected a client sends are ignored.
    v_err := null; v_t := '';
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      for v_rec in
        insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, sector_id, status, auto_connected)
        values (v_s, v_n, v_os, v_on, repeat('y', 600), null, 'pending', false),
               (v_s, v_n, v_os, v_on, null, null, 'pending', false),
               (v_s, v_r, null, v_om, 'Dry run: old client to a matching company', null, 'accepted', true)
        returning status::text as s, auto_connected as a, marina_organization_id as mo, partner_organization_id as po
      loop
        v_t := v_t || format('%s/%s/%s ', v_rec.s, v_rec.a, v_rec.po = v_os);
      end loop;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_t = 'pending/false/true pending/false/true pending/false/true ', false);
    results := results || pg_temp.dr('C05', v_ok, 'old-client inserts unchanged (600 chars ok, duplicates ok, never auto-connected, status forced pending, org filled): '
      || coalesce(v_err, v_t));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- C06: an unverified account cannot send (existing insert policy).
    if v_u is null then
      results := results || E'\nINFO C06 no unverified account with a company: not run';
    else
      v_err := null; v_state := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into public.partner_requests (partner_user_id, marina_user_id, message) values (v_u, v_n, 'Dry run: unverified');
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      end;
      v_ok := v_state = '42501';
      results := results || pg_temp.dr('C06', v_ok, 'unverified account refused: ' || coalesce(v_state || ' ' || v_err, 'ALLOWED'));
      n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;
    end if;

    -- C08: a signed-in client cannot date its request (in the future: unread and first
    -- in every list for ever; in the past: out of the 24-hour count).
    v_err := null; v_t := '';
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      for v_rec in
        insert into public.partner_requests (partner_user_id, marina_user_id, message, created_at, updated_at)
        values (v_s, v_n, 'Dry run: dated 2099', '2099-01-01', '2099-01-01'),
               (v_s, v_n, 'Dry run: dated 2000', '2000-01-01', '2000-01-01')
        returning created_at = now() and updated_at = now() as ok
      loop
        v_t := v_t || v_rec.ok::text || ' ';
      end loop;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_t = 'true true ', false);
    results := results || pg_temp.dr('C08', v_ok, 'dates sent by the client are replaced by now(): ' || coalesce(v_err, v_t));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- C07: 20 requests per sender in 24 h (C05 and C08 already wrote some), each sent
    -- dated in the past: they still count.
    select count(*) into v_k from public.partner_requests where partner_user_id = v_s and created_at > now() - interval '24 hours';
    v_err := null; v_hint := null; v_i := 0;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      for v_j in 1 .. greatest(20 - v_k, 0) loop
        insert into public.partner_requests (partner_user_id, marina_user_id, message, created_at) values (v_s, v_n, 'Dry run: volume ' || v_j, '2000-01-01');
        v_i := v_i + 1;
      end loop;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_t := coalesce(v_err, 'ok');
    v_err := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, message) values (v_s, v_n, 'Dry run: one too many');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    v_ok := v_t = 'ok' and v_hint = 'rate_limited';
    results := results || pg_temp.dr('C07', v_ok, format('requests 1..20 in 24 h accepted (%s more written, dated 2000: %s), the 21st -> %s', v_i, v_t, coalesce(v_hint, coalesce(v_err, 'ALLOWED'))));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    raise exception using errcode = 'DRY01', message = 'scenario C finished';
  exception
    when sqlstate 'DRY01' then null;
    when others then
      get stacked diagnostics v_err = message_text;
      results := results || pg_temp.dr('C--', false, 'scenario C crashed: ' || v_err);
      n_fail := n_fail + 1;
  end;
  perform set_config('request.jwt.claims', '', true);

  /* ═══════════════════════ D. 60 messages per author per hour ═══════════════════════ */
  begin
    v_err := null; v_req := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin)
      values (v_s, v_r, v_os, v_om, c_first, 'message')
      returning id into v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    if v_req is null then raise exception 'D setup failed: %', v_err; end if;

    v_err := null; v_i := 0;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      for v_j in 1 .. 60 loop
        insert into public.conversation_messages (partner_request_id, body) values (v_req, 'Dry run message ' || v_j);
        v_i := v_i + 1;
      end loop;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_t := coalesce(v_err, 'ok');
    v_err := null; v_hint := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_messages (partner_request_id, body) values (v_req, 'Dry run message 61');
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
    end;
    -- 4001 characters are refused by the table itself.
    v_t2 := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_messages (partner_request_id, body) values (v_req, repeat('z', 4001));
      reset role;
    exception when others then
      get stacked diagnostics v_t2 = returned_sqlstate;
    end;
    v_ok := v_t = 'ok' and v_i = 60 and v_hint = 'rate_limited' and v_t2 = '23514';
    results := results || pg_temp.dr('D01', v_ok, format('60 messages in an hour accepted (%s, %s), the 61st -> %s; 4001 characters -> %s',
      v_i, v_t, coalesce(v_hint, coalesce(v_err, 'ALLOWED')), coalesce(v_t2, 'ALLOWED')));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- D02: msg_mark_read up to the newest message shown: what came after stays unread;
    -- the marker never moves back.
    v_err := null; v_i := null; v_j := null; v_k := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.msg_mark_read(v_req, now() - interval '1 second');
      select c.unread_count into v_i from public.msg_conversations() c where c.partner_request_id = v_req;
      perform public.msg_mark_read(v_req);
      select c.unread_count into v_j from public.msg_conversations() c where c.partner_request_id = v_req;
      perform public.msg_mark_read(v_req, '2000-01-01');
      select c.unread_count into v_k from public.msg_conversations() c where c.partner_request_id = v_req;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    v_ok := coalesce(v_err is null and v_i = 60 and v_j = 0 and v_k = 0, false);
    results := results || pg_temp.dr('D02', v_ok, 'read up to an earlier message: 60 still unread; read now: 0; an older time later: still 0. '
      || coalesce(v_err, format('%s / %s / %s', v_i, v_j, v_k)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    raise exception using errcode = 'DRY01', message = 'scenario D finished';
  exception
    when sqlstate 'DRY01' then null;
    when others then
      get stacked diagnostics v_err = message_text;
      results := results || pg_temp.dr('D--', false, 'scenario D crashed: ' || v_err);
      n_fail := n_fail + 1;
  end;

  perform set_config('request.jwt.claims', '', true);

  /* ═══════════════════════ E. at most 5 automatic connections per company in 24 h ═══════════════════════ */
  begin
    -- Five automatic connections made by OS today (written as the service would, to ON,
    -- then withdrawn so they do not block OM): S's message to the matching OM waits.
    for v_j in 1 .. 5 loop
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, status)
      values (v_s, v_n, v_os, v_on, 'Dry run: earlier automatic connection ' || v_j, 'withdrawn')
      returning id into v_req2;
      update public.partner_requests set auto_connected = true where id = v_req2;
    end loop;
    select count(*) into v_k from public.partner_requests
     where partner_organization_id = v_os and auto_connected and created_at > now() - interval '24 hours';
    v_err := null; v_status := null; v_auto := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, origin)
      values (v_s, v_r, v_os, v_om, c_first, 'message')
      returning status::text, auto_connected into v_status, v_auto;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := coalesce(v_err is null and v_k = 5 and v_status = 'pending' and not v_auto, false);
    results := results || pg_temp.dr('E01', v_ok, 'after 5 automatic connections today, a 6th matching message waits for an answer. '
      || coalesce(v_err, format('earlier automatic=%s status=%s auto=%s', v_k, v_status, v_auto)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    raise exception using errcode = 'DRY01', message = 'scenario E finished';
  exception
    when sqlstate 'DRY01' then null;
    when others then
      get stacked diagnostics v_err = message_text;
      results := results || pg_temp.dr('E--', false, 'scenario E crashed: ' || v_err);
      n_fail := n_fail + 1;
  end;
  perform set_config('request.jwt.claims', '', true);

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (company messaging, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
