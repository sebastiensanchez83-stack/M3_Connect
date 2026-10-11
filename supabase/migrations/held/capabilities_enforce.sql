-- HELD FOR THE SWITCH. Do not apply with the other migrations, and keep this file
-- out of supabase/migrations/ (where `supabase db push` would pick it up) until
-- the day. The day is the GO-LIVE of the refonte (Victor, 11 Oct 2026): the day the
-- refonte replaces main as the live site, never before (the old site's buttons
-- follow the persona). The steps, the expected counts and the rollback are in
-- docs/rights-switch-runbook.md. In short: deploy the refonte as the live site,
-- give this file a timestamp (YYYYMMDDHHMMSS_capabilities_enforce.sql) and move it
-- to supabase/migrations/, run its dry run (supabase/dryrun/capabilities_enforce.dryrun.sql),
-- then apply it. No e-mail goes to the people who gain or lose a right (Victor,
-- 11 Oct 2026): nothing here or in the site sends one.
--
-- Rights per company type, ENFORCED: the database applies the rule of
-- 20261011090000_capabilities_shadow.sql (which must be applied first), and the
-- site's switch registration_flags.capabilities_enforced turns on in the same
-- transaction, so the screens and the database change together.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What changes (each policy is rewritten explicitly; nothing is blanket-wrapped)
-- ════════════════════════════════════════════════════════════════════════════
--  rfps, consultations (the same four policies each, and one trigger each)
--    *_select_marketplace     staff, the author, or an APPROVED need for anyone with
--                             has_capability('see_opportunities') (was: any status for
--                             has_marketplace_access(), i.e. persona marina, partner,
--                             media_partner, or Individual + partner_like; submitted,
--                             rejected and archived needs, with their admin_notes and
--                             rejection_reason, no longer reach other readers)
--    *_select_developer       dropped (developers see through their company type)
--    *_write_owner, *_write_owner_developer (FOR ALL, persona marina / developer)
--                             replaced by three policies and a trigger:
--      *_insert_publisher     the author is the caller, organization_id is set, and
--                             has_capability('publish_needs', organization_id): the
--                             PUBLISHING company must be a validated marina or
--                             developer of theirs (not the persona, not "any company")
--      *_update_owner         the author, while verified; the trigger
--      trg_*_publish_right    (guard_need_publish_right) then lets them CLOSE their
--                             need whatever their rights (the author can always
--                             withdraw), and asks for anything else (editing,
--                             reopening, moving it to another company)
--                             has_capability('publish_needs', organization_id) of the
--                             company the need is filed under after the change
--      *_delete_owner         the author, while verified (they can always withdraw)
--  marina_projects
--    marina_projects_insert   the author is the caller, organization_id is set, and
--                             has_capability('publish_needs', organization_id)
--                             (was: any signed-in user; only the page checked)
--    select / update / delete unchanged (projects stay visible to their author and M3)
--  partner_requests
--    partner_requests_insert_verified (any verified person) becomes
--    partner_requests_insert_capable, by origin:
--      'message'  (Send a message, company page)  partner_organization_id is set and
--                 has_capability('message_companies', partner_organization_id): the
--                 sending company must give that right
--      'interest' (Express interest, Opportunities) in the caller's own name, from
--                 a company that answers needs: has_capability('answer_needs',
--                 partner_organization_id); never to themselves or to their own
--                 company (a developer both publishes and answers). A marina never
--                 answers a need, even when its member also belongs to a service
--                 provider: the answer goes out under the company that may answer.
--      null       (old site: connection requests, Express interest, Deal flow)
--                 has_capability('message_companies')
--    The check constraint now accepts origin 'interest' (the new site sends it for
--    Express interest once the switch is on). Its triggers treat it like null.
--    "Marinas read needs, read-only" is enforced for Express interest only: a
--    marina may still WRITE to the company that published a need (Send a message,
--    origin 'message', or the old site's null origin), like any company, since the
--    table gives marinas message_companies. The site hides Express interest from
--    marinas; nothing hides Send a message, on purpose.
--  webinar_requests
--    webinar_requests_insert_owner_eligible: has_capability('propose_webinar')
--    (every verified person has it through the participant set: same people as today)
--  org_capital_intents (Deal flow: the only table the board reads that is not public)
--    oci_select_verified_investors (persona investor) becomes oci_select_dealflow:
--    has_capability('see_dealflow'): members of a validated investor company, staff,
--    and a verified SM26-confirmed investor whatever their company (the one
--    person-level exception of the shadow migration, capability_sm26_investor;
--    Victor, 11 Oct 2026: they keep Deal flow WITH its data). The exception gives
--    see_dealflow only: no other policy here reads it, so it opens this one read
--    path and nothing else (no publishing, no answering, no messaging).
--  platform_settings.registration_flags.capabilities_enforced := true
--
-- NOT changed, on purpose:
--  * has_marketplace_access() and is_partner_like() keep their persona rule. They
--    still serve can_access_resource() (resources and events with access level
--    'members' or anything not public/marina) and partners_select_directory (the
--    legacy partners table). Moving those is a separate decision (they reach people
--    the rights table does not talk about).
--  * Reading company pages, teams and marina details; events; resources.
--  * Receiving messages and requests: the table limits who SENDS, not who receives.
--  * Conversations already open: conversation_messages keeps its own rules.
--
-- Old site (main), if it is still live on the day: its buttons follow the persona.
-- A member the rule refuses gets a database refusal instead of a hidden button:
-- the 4 "Prestataire" persons without a validated company (Express interest), the
-- 15 persons without a validated company (Request to connect), people whose
-- active company cannot publish (Submit an RFP / consultation / project).
-- Apply this switch only once the refonte is the live site.
--
-- UNDO: supabase/migrations/down/capabilities_enforce.down.sql (restores every
-- policy byte for byte, the check constraint, and the flag; 'interest' rows go
-- back to origin null; drops the trigger guard). It refuses to run if the policies
-- or the guard this file creates were changed after it: section 10 records their
-- fingerprint in the comment of partner_requests_insert_capable.
-- Dry run: supabase/dryrun/capabilities_enforce.dryrun.sql (applies the shadow
-- migration AND this file in one transaction, tests every row of the table, then
-- the down script).
--
-- Locks: ACCESS EXCLUSIVE on rfps, consultations, marina_projects,
-- partner_requests, webinar_requests and org_capital_intents until it commits.
-- It gives up after 5 s waiting for any one lock (lock_timeout), so it never
-- holds the tables it already took while queuing behind a long transaction:
-- if it gives up, nothing is applied; run it again at a quieter moment.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ─── 0. Preconditions ────────────────────────────────────────────────────────
do $pre$
declare
  v_fp text;
begin
  -- a. The shadow migration is applied, in its version with the SM26 investor
  --    exception (11 Oct 2026).
  if to_regclass('public.org_type_capability') is null
     or to_regprocedure('public.has_capability(text, uuid)') is null
     or to_regprocedure('public.capability_sm26_investor(uuid)') is null
     or not exists (select 1 from public.org_type_capability) then
    raise exception 'capabilities switch: apply 20261011090000_capabilities_shadow.sql first';
  end if;
  if not exists (select 1 from public.platform_settings
                  where key = 'registration_flags' and jsonb_typeof(value) = 'object') then
    raise exception 'capabilities switch: platform_settings.registration_flags is missing';
  end if;

  -- b. The twelve policies replaced here are still the ones reviewed on 10 Oct 2026.
  select md5(string_agg(format('%s.%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, cmd, roles,
                               coalesce(qual, ''), coalesce(with_check, '')), ';' order by tablename, policyname))
    into v_fp
    from pg_policies
   where schemaname = 'public'
     and (tablename, policyname) in (
       ('rfps', 'rfps_select_developer'), ('rfps', 'rfps_select_marketplace'),
       ('rfps', 'rfps_write_owner'), ('rfps', 'rfps_write_owner_developer'),
       ('consultations', 'consultations_select_developer'), ('consultations', 'consultations_select_marketplace'),
       ('consultations', 'consultations_write_owner'), ('consultations', 'consultations_write_owner_developer'),
       ('marina_projects', 'marina_projects_insert'),
       ('partner_requests', 'partner_requests_insert_verified'),
       ('webinar_requests', 'webinar_requests_insert_owner_eligible'),
       ('org_capital_intents', 'oci_select_verified_investors'));
  if v_fp is distinct from '346cf3dfbde3b3b4da4f6dc04f7e3b84' then
    raise exception 'capabilities switch: the policies to replace changed since 10 Oct 2026 (fingerprint %); re-read them and rebuild this file and its down script', v_fp;
  end if;

  -- c. The origin rule is the one of 20261009190000_company_messaging.
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = 'public.partner_requests'::regclass and c.conname = 'partner_requests_origin_check')
     is distinct from 'CHECK (((origin IS NULL) OR (origin = ''message''::text)))' then
    raise exception 'capabilities switch: partner_requests_origin_check changed; re-read it';
  end if;

  -- d. Every RFP and consultation is filed under a company (both sites send the
  --    active company; no row without one on 10 Oct 2026). Under the switch the
  --    author of a need without a company can still close or delete it, never edit
  --    or reopen it: attach such needs to their author's marina or developer
  --    company first (an UPDATE of organization_id, as postgres).
  if exists (select 1 from public.rfps where organization_id is null)
     or exists (select 1 from public.consultations where organization_id is null) then
    raise exception 'capabilities switch: % RFP(s) and % consultation(s) have no organization_id; attach them to their author''s company first',
      (select count(*) from public.rfps where organization_id is null),
      (select count(*) from public.consultations where organization_id is null);
  end if;
end
$pre$;

-- ─── 1. partner_requests.origin: 'interest' ──────────────────────────────────
alter table public.partner_requests drop constraint partner_requests_origin_check;
alter table public.partner_requests
  add constraint partner_requests_origin_check
  check (origin is null or origin in ('message', 'interest'));

-- ─── 2. The publisher's guard on updates (rfps, consultations) ───────────────
-- The author may always CLOSE their need (is_open true -> false, nothing else),
-- whatever their rights today: a need must never stay open because its author's
-- company was suspended or retyped, or because they left it. Anything else
-- (editing, reopening, moving the need to another company) needs publish_needs
-- through the company the need is filed under after the change.
-- SECURITY INVOKER on purpose (as guard_need_moderation_columns): current_user is
-- the role doing the write; postgres (RPCs, migrations, cron) and service_role
-- (edge functions) pass untouched, and so do verified staff. Fires after
-- trg_*_guard_moderation (triggers run in name order), which has already put back
-- the status and moderation columns a member may not change.
create or replace function public.guard_need_publish_right()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.is_moderator() then
    return new;
  end if;

  -- Closing (or leaving closed), and nothing else changes.
  if new.is_open is not true
     and (to_jsonb(new) - 'is_open' - 'updated_at') = (to_jsonb(old) - 'is_open' - 'updated_at') then
    return new;
  end if;

  if new.organization_id is null
     or not public.has_capability('publish_needs', new.organization_id) then
    raise exception 'Only a member of a validated marina or developer company can change this need. You can still close or delete it.'
      using errcode = '42501', hint = 'publish_needs';
  end if;
  return new;
end
$function$;

comment on function public.guard_need_publish_right() is
  'BEFORE UPDATE on rfps and consultations (capabilities switch): the author may close their need whatever their rights; any other change needs has_capability(''publish_needs'', organization_id). Staff, postgres and service_role pass. 2026-10-10.';
-- Privileges left at the default, as for the other trigger functions of these
-- tables (a trigger function cannot be called on its own).

drop trigger if exists trg_rfps_publish_right on public.rfps;
create trigger trg_rfps_publish_right
  before update on public.rfps
  for each row execute function public.guard_need_publish_right();

drop trigger if exists trg_consultations_publish_right on public.consultations;
create trigger trg_consultations_publish_right
  before update on public.consultations
  for each row execute function public.guard_need_publish_right();

-- ─── 3. rfps ─────────────────────────────────────────────────────────────────
drop policy if exists rfps_select_developer on public.rfps;
drop policy if exists rfps_write_owner on public.rfps;
drop policy if exists rfps_write_owner_developer on public.rfps;
drop policy if exists rfps_select_marketplace on public.rfps;

create policy rfps_select_marketplace on public.rfps
  for select
  to authenticated
  using (
    public.is_moderator()
    or marina_user_id = (select auth.uid())
    or (status = 'approved' and (select public.has_capability('see_opportunities')))
  );

create policy rfps_insert_publisher on public.rfps
  for insert
  to authenticated
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

-- What may change is decided by trg_rfps_publish_right (section 2).
create policy rfps_update_owner on public.rfps
  for update
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.is_verified(null::public.persona_enum))
  )
  with check (
    marina_user_id = (select auth.uid())
  );

create policy rfps_delete_owner on public.rfps
  for delete
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.is_verified(null::public.persona_enum))
  );

-- ─── 4. consultations ────────────────────────────────────────────────────────
drop policy if exists consultations_select_developer on public.consultations;
drop policy if exists consultations_write_owner on public.consultations;
drop policy if exists consultations_write_owner_developer on public.consultations;
drop policy if exists consultations_select_marketplace on public.consultations;

create policy consultations_select_marketplace on public.consultations
  for select
  to authenticated
  using (
    public.is_moderator()
    or marina_user_id = (select auth.uid())
    or (status = 'approved' and (select public.has_capability('see_opportunities')))
  );

create policy consultations_insert_publisher on public.consultations
  for insert
  to authenticated
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

-- What may change is decided by trg_consultations_publish_right (section 2).
create policy consultations_update_owner on public.consultations
  for update
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.is_verified(null::public.persona_enum))
  )
  with check (
    marina_user_id = (select auth.uid())
  );

create policy consultations_delete_owner on public.consultations
  for delete
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.is_verified(null::public.persona_enum))
  );

-- ─── 5. marina_projects ──────────────────────────────────────────────────────
drop policy if exists marina_projects_insert on public.marina_projects;

create policy marina_projects_insert on public.marina_projects
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

-- ─── 6. partner_requests ─────────────────────────────────────────────────────
drop policy if exists partner_requests_insert_verified on public.partner_requests;

-- Runs after the BEFORE INSERT triggers: partner_organization_id and
-- marina_organization_id are already companies of the sender and of the recipient
-- (partner_request_user_org), never ones they are not in.
create policy partner_requests_insert_capable on public.partner_requests
  for insert
  to authenticated
  with check (
    (partner_user_id = (select auth.uid()) or marina_user_id = (select auth.uid()))
    and case origin
          when 'message'  then partner_organization_id is not null
                               and public.has_capability('message_companies', partner_organization_id)
          when 'interest' then partner_organization_id is not null
                               and partner_user_id = (select auth.uid())
                               and marina_user_id is distinct from partner_user_id
                               and marina_organization_id is distinct from partner_organization_id
                               and public.has_capability('answer_needs', partner_organization_id)
          else (select public.has_capability('message_companies'))
        end
  );

-- ─── 7. webinar_requests ─────────────────────────────────────────────────────
drop policy if exists webinar_requests_insert_owner_eligible on public.webinar_requests;

create policy webinar_requests_insert_owner_eligible on public.webinar_requests
  for insert
  to public
  with check (
    (user_id = (select auth.uid()) and (select public.has_capability('propose_webinar')))
    or public.is_moderator()
  );

-- ─── 8. org_capital_intents (Deal flow) ──────────────────────────────────────
-- has_capability('see_dealflow') is true for members of a validated investor
-- company, for staff, and for a verified SM26-confirmed investor (capability_set's
-- exception), so those keep reading the board's rows after the switch.
drop policy if exists oci_select_verified_investors on public.org_capital_intents;

create policy oci_select_dealflow on public.org_capital_intents
  for select
  to public
  using ((select public.has_capability('see_dealflow')));

-- ─── 9. The site follows ─────────────────────────────────────────────────────
update public.platform_settings
   set value = jsonb_set(value, '{capabilities_enforced}', 'true'::jsonb, true),
       updated_at = now()
 where key = 'registration_flags';

-- ─── 10. Postcondition, and the fingerprint the down script checks ───────────
do $post$
declare
  v_fp text;
begin
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and (coalesce(qual, '') like '%has_capability%' or coalesce(with_check, '') like '%has_capability%')) <> 8 then
    raise exception 'capabilities switch: expected 8 policies calling has_capability';
  end if;
  if (select value -> 'capabilities_enforced' from public.platform_settings where key = 'registration_flags')
     is distinct from 'true'::jsonb then
    raise exception 'capabilities switch: the flag did not turn on';
  end if;

  -- The twelve policies this file leaves and the guard's body, as applied. The
  -- down script recomputes the same value and refuses to undo a later edit
  -- silently. (Same expression in down/capabilities_enforce.down.sql.)
  select md5(string_agg(format('%s.%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, cmd, roles,
                               coalesce(qual, ''), coalesce(with_check, '')), ';' order by tablename, policyname)
             || coalesce((select md5(p.prosrc) from pg_proc p
                           where p.oid = to_regprocedure('public.guard_need_publish_right()')), '-'))
    into v_fp
    from pg_policies
   where schemaname = 'public'
     and (tablename, policyname) in (
       ('rfps', 'rfps_select_marketplace'), ('rfps', 'rfps_insert_publisher'),
       ('rfps', 'rfps_update_owner'), ('rfps', 'rfps_delete_owner'),
       ('consultations', 'consultations_select_marketplace'), ('consultations', 'consultations_insert_publisher'),
       ('consultations', 'consultations_update_owner'), ('consultations', 'consultations_delete_owner'),
       ('marina_projects', 'marina_projects_insert'),
       ('partner_requests', 'partner_requests_insert_capable'),
       ('webinar_requests', 'webinar_requests_insert_owner_eligible'),
       ('org_capital_intents', 'oci_select_dealflow'));
  execute format('comment on policy partner_requests_insert_capable on public.partner_requests is %L',
                 'Rights per company type (held/capabilities_enforce.sql). Switch fingerprint ' || v_fp);
end
$post$;
