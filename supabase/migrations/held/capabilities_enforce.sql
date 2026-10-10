-- HELD FOR THE SWITCH. Do not apply with the other migrations, and keep this file
-- out of supabase/migrations/ (where `supabase db push` would pick it up) until
-- Victor has signed off the shadow report and chosen the date. On the day: give
-- it a timestamp (YYYYMMDDHHMMSS_capabilities_enforce.sql), move it to
-- supabase/migrations/, run its dry run (supabase/dryrun/capabilities_enforce.dryrun.sql),
-- then apply it.
--
-- Rights per company type, ENFORCED: the database applies the rule of
-- 20261010200000_capabilities_shadow.sql (which must be applied first), and the
-- site's switch registration_flags.capabilities_enforced turns on in the same
-- transaction, so the screens and the database change together.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What changes (each policy is rewritten explicitly; nothing is blanket-wrapped)
-- ════════════════════════════════════════════════════════════════════════════
--  rfps, consultations (the same four policies each)
--    *_select_marketplace     staff, the author, or has_capability('see_opportunities')
--                             (was: has_marketplace_access(), i.e. persona marina,
--                             partner, media_partner, or Individual + partner_like)
--    *_select_developer       dropped (developers see through their company type)
--    *_write_owner, *_write_owner_developer (FOR ALL, persona marina / developer)
--                             replaced by three policies:
--      *_insert_publisher     the author is the caller, organization_id is set, and
--                             has_capability('publish_needs', organization_id): the
--                             PUBLISHING company must be a validated marina or
--                             developer of theirs (not the persona, not "any company")
--      *_update_owner         the author, while they can publish; the row stays
--                             attached to a company that lets them publish
--      *_delete_owner         the author, while verified (they can always withdraw)
--  marina_projects
--    marina_projects_insert   the author is the caller, organization_id is set, and
--                             has_capability('publish_needs', organization_id)
--                             (was: any signed-in user; only the page checked)
--    select / update / delete unchanged (projects stay visible to their author and M3)
--  partner_requests
--    partner_requests_insert_verified (any verified person) becomes
--    partner_requests_insert_capable, by origin:
--      'message'  (Send a message, company page)  has_capability('message_companies',
--                 partner_organization_id): the sending company must give that right
--      'interest' (Express interest, Opportunities) has_capability('answer_needs')
--      null       (old site: connection requests, Express interest, Deal flow)
--                 has_capability('message_companies')
--    The check constraint now accepts origin 'interest' (the new site sends it for
--    Express interest once the switch is on). Its triggers treat it like null.
--  webinar_requests
--    webinar_requests_insert_owner_eligible: has_capability('propose_webinar')
--    (every verified person has it through the participant set: same people as today)
--  org_capital_intents
--    oci_select_verified_investors (persona investor) becomes oci_select_dealflow:
--    has_capability('see_dealflow') (members of a validated investor company, and staff)
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
-- back to origin null).
-- Dry run: supabase/dryrun/capabilities_enforce.dryrun.sql (applies the shadow
-- migration AND this file in one transaction, tests every row of the table, then
-- the down script).

-- ─── 0. Preconditions ────────────────────────────────────────────────────────
do $pre$
declare
  v_fp text;
begin
  -- a. The shadow migration is applied.
  if to_regclass('public.org_type_capability') is null
     or to_regprocedure('public.has_capability(text, uuid)') is null
     or not exists (select 1 from public.org_type_capability) then
    raise exception 'capabilities switch: apply 20261010200000_capabilities_shadow.sql first';
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
end
$pre$;

-- ─── 1. partner_requests.origin: 'interest' ──────────────────────────────────
alter table public.partner_requests drop constraint partner_requests_origin_check;
alter table public.partner_requests
  add constraint partner_requests_origin_check
  check (origin is null or origin in ('message', 'interest'));

-- ─── 2. rfps ─────────────────────────────────────────────────────────────────
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
    or (select public.has_capability('see_opportunities'))
  );

create policy rfps_insert_publisher on public.rfps
  for insert
  to authenticated
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

create policy rfps_update_owner on public.rfps
  for update
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.has_capability('publish_needs'))
  )
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

create policy rfps_delete_owner on public.rfps
  for delete
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.is_verified(null::public.persona_enum))
  );

-- ─── 3. consultations ────────────────────────────────────────────────────────
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
    or (select public.has_capability('see_opportunities'))
  );

create policy consultations_insert_publisher on public.consultations
  for insert
  to authenticated
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

create policy consultations_update_owner on public.consultations
  for update
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.has_capability('publish_needs'))
  )
  with check (
    marina_user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

create policy consultations_delete_owner on public.consultations
  for delete
  to authenticated
  using (
    marina_user_id = (select auth.uid())
    and (select public.is_verified(null::public.persona_enum))
  );

-- ─── 4. marina_projects ──────────────────────────────────────────────────────
drop policy if exists marina_projects_insert on public.marina_projects;

create policy marina_projects_insert on public.marina_projects
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id is not null
    and public.has_capability('publish_needs', organization_id)
  );

-- ─── 5. partner_requests ─────────────────────────────────────────────────────
drop policy if exists partner_requests_insert_verified on public.partner_requests;

-- Runs after the BEFORE INSERT triggers: partner_organization_id is already the
-- sender's own company (partner_request_user_org), never one they are not in.
create policy partner_requests_insert_capable on public.partner_requests
  for insert
  to authenticated
  with check (
    (partner_user_id = (select auth.uid()) or marina_user_id = (select auth.uid()))
    and case origin
          when 'message'  then public.has_capability('message_companies', partner_organization_id)
          when 'interest' then (select public.has_capability('answer_needs'))
          else (select public.has_capability('message_companies'))
        end
  );

-- ─── 6. webinar_requests ─────────────────────────────────────────────────────
drop policy if exists webinar_requests_insert_owner_eligible on public.webinar_requests;

create policy webinar_requests_insert_owner_eligible on public.webinar_requests
  for insert
  to public
  with check (
    (user_id = (select auth.uid()) and (select public.has_capability('propose_webinar')))
    or public.is_moderator()
  );

-- ─── 7. org_capital_intents (Deal flow) ──────────────────────────────────────
drop policy if exists oci_select_verified_investors on public.org_capital_intents;

create policy oci_select_dealflow on public.org_capital_intents
  for select
  to public
  using ((select public.has_capability('see_dealflow')));

-- ─── 8. The site follows ─────────────────────────────────────────────────────
update public.platform_settings
   set value = jsonb_set(value, '{capabilities_enforced}', 'true'::jsonb, true),
       updated_at = now()
 where key = 'registration_flags';

-- ─── 9. Postcondition ────────────────────────────────────────────────────────
do $post$
begin
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and (coalesce(qual, '') like '%has_capability%' or coalesce(with_check, '') like '%has_capability%')) <> 10 then
    raise exception 'capabilities switch: expected 10 policies calling has_capability';
  end if;
  if (select value -> 'capabilities_enforced' from public.platform_settings where key = 'registration_flags')
     is distinct from 'true'::jsonb then
    raise exception 'capabilities switch: the flag did not turn on';
  end if;
end
$post$;
