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
