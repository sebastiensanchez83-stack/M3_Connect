-- Unified registration, Phase 1 (DB lane): the registration core.
-- Spec: regspec-en.md §3.1-3.8, §3.11, §4.6 (Phase 1 part), §15 Phase 1 DB row.
-- CONTRACT for the EDGE, REG and ADMIN lanes: docs/registration-contract.md
-- (tables, columns, values, RPC signatures and shapes, RLS, flags).
-- Apply AFTER 20261009200000_registration_prereqs (checked below).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Production facts (read-only, 9 Oct 2026)
-- ════════════════════════════════════════════════════════════════════════════
-- * gl_event: 1 row (wys26, requests_open true) + the 2 hidden canaries of
--   registration_prereqs. gl_guest: 3 wys26 rows (source request, status
--   requested). No trigger on gl_guest or gl_event.
-- * guest-list (edge function, FROZEN until 28 Nov, not redeployed) reads
--   gl_event (id, slug, title, capacity, notify_email, requests_open, settings),
--   inserts gl_guest rows with source request|invitation|plus_one and status
--   requested|invited|confirmed, updates status to confirmed|declined|rejected|
--   cancelled, conference, gala, admin_note, decided_*, responded_at, and
--   select('*')s rows back. Seats held = confirmed + invited.
-- * profiles: no country/phone/linkedin/affiliation/proof column. profiles.email
--   equals auth.users.email for all 155 accounts (0 differences).
-- * auth: "Confirm email" is still OFF in effect: 0 unconfirmed users, only 1
--   has confirmation_sent_at. With it off, GoTrue inserts a user and then sets
--   email_confirmed_at in an UPDATE of the same transaction, so
--   email_confirmed_at going from null to a value PROVES NOTHING unless an
--   e-mail was sent first (confirmation_sent_at / invited_at / recovery_sent_at
--   set before the update). The proof trigger below relies on exactly that.
-- * trg_link_guest_registrations (AFTER INSERT ON profiles) links legacy
--   event_registrations guest rows to any new account typed with the same
--   address, unproven. event_registrations: 1 row.
-- * get_my_event_access(uuid[]) exists (20261007141936) and returns
--   (event_id, is_registered, meeting_url).
-- * pg_cron runs in GMT. Vault holds project_url and service_role_key (used by
--   invoke_send_profile_reminders, migration 20261006144203).
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration adds (all additive; see the contract for every detail)
-- ════════════════════════════════════════════════════════════════════════════
--  0. Lock and statement timeouts (set local). This file takes ACCESS EXCLUSIVE
--     locks on gl_event, gl_guest and profiles (profiles is read by
--     is_moderator(), so by almost every RLS policy) and SHARE ROW EXCLUSIVE on
--     auth.users (foreign keys, triggers), events and event_registrations
--     (triggers; reads go on, writes wait). lock_timeout 5 s: if another session
--     holds one of them, the migration gives up instead of queueing every
--     request of the live site behind it. "canceling statement due to lock
--     timeout": nothing was applied; run it again a little later.
--  1. gl_event: engine, kind, registration_mode, public_requests, access,
--     opens_at, closes_at, edit_locks_at, waitlist, plus_ones, standard_fields,
--     account_email_timing, account_email_send_at, meeting_url, replay_url,
--     reminders, door_token, staff_alert_mode, updated_at; CHECKs
--     gl_event_instant_is_webinar, gl_event_v2_no_legacy_requests and
--     gl_event_door_matches_engine (guest_list_v1 = shared door, core_v2 =
--     separate door: a printed WYS QR can never be refused by a door setting,
--     and a core_v2 gl_guest.token is never a door pass); unique
--     legacy_event_id. Every column has a default that reproduces today's
--     behaviour: an existing or legacy-inserted row is guest_list_v1 / onsite /
--     invitation / shared door.
--     Backfill: wys26 keeps those values; its account e-mail timing is
--     'with_confirmation' (Victor, 7 Oct: WYS guests get their account at
--     validation, not after the gala; spec Q2 default was after_event).
--     canary-v2 becomes core_v2 / webinar / instant / separate door.
--  2. gl_ticket and gl_question (new), staff-only RLS like gl_event.
--  3. gl_guest: user_id, organization_id, ticket_key, answers, consents,
--     source_detail, payment_status, amount_cents, currency, checkin_token,
--     info_request, info_requested_at, link_opened_at, cancelled_at,
--     reminders_sent, account_action, provisioned_at, updated_at; status and
--     source CHECKs widened (needs_info, waitlisted, approved; registration);
--     unique (event_id, user_id); lookup indexes.
--  4. gl_access_token (new): sha256 of status-link tokens, service role only.
--  5. account_provision_job (new): the provisioning outbox.
--  6. review_log (new) + review_log_add().
--  7. profiles: country, phone, linkedin_url, affiliation, signup_source
--     (existing rows 'legacy'), signup_intent, email_proven_at,
--     email_changed_at; profile_interest_sectors (new); the
--     prevent_profile_privilege_escalation guard (exact current body, md5-checked,
--     plus block 1b) freezes email, email_proven_at, email_changed_at,
--     signup_source and signup_intent against direct API writes by non-admins.
--  8. guest_signup_rate_limits.scope (nullable) + indexes.
--  9. Helpers (service role): gl_try_ts, gl_event_window, gl_seats_held,
--     gl_registration_state, gl_register_v2 (atomic core_v2 registration:
--     capacity, duplicates, tickets, answers, standard fields; refuses an
--     unpublished catalogue event), gl_decide_v2 (atomic staff decision: event
--     row locked for capacity, statuses, the provisioning job's choices and
--     review_log in one transaction), gl_issue_access_token,
--     gl_resolve_access_token. Public: public_registration_events().
-- 10. Triggers on gl_guest:
--       gl_guest_engine_guard (BEFORE INSERT OR UPDATE): guest_list_v1 rows keep
--         the legacy 6 statuses / 3 sources and no checkin_token, and a NEW v1
--         row keeps a user_id only when that account proved the row's address
--         (else user_id is dropped silently); core_v2 rows: source 'request'
--         written only in invitation mode (existing rows stay editable after a
--         mode change), a new 'plus_one' row only when the event allows
--         plus-ones, checkin_token minted at confirmation when door_token =
--         'separate'; cancelled_at and updated_at stamped. guest-list only
--         writes legacy values and never user_id, so it is never blocked on wys26.
--       gl_guest_queue_provisioning (AFTER INSERT OR UPDATE OF status): a row
--         becoming 'confirmed' on an on-site event queues one
--         account_provision_job; a row confirmed AGAIN re-queues its job when it
--         was skipped or failed (a queued or done job is left alone). Its body is
--         wrapped in EXCEPTION WHEN OTHERS -> RAISE WARNING: it can never abort a
--         write of guest-list. Backfill: a row ALREADY confirmed on an on-site
--         event when this migration runs (a wys26 guest approved before the
--         apply) gets its job too, once (ON CONFLICT DO NOTHING).
-- 11. Identity: attach_my_records(), attach_my_records_for(uuid),
--     mark_email_proven(), on_email_proven(uuid), complete_signup_for(uuid)
--     (a no-op placeholder that Phase 2 replaces), and two AFTER UPDATE
--     triggers on auth.users (e-mail confirmed after a sent link; e-mail
--     changed). Both swallow every error (RAISE WARNING): auth never breaks.
--     postgres may CREATE OR REPLACE them (TRIGGER privilege) but not DROP them
--     (auth.users belongs to supabase_auth_admin): the undo turns their
--     functions into no-ops.
--     DROP TRIGGER trg_link_guest_registrations (its function is kept, unused).
-- 12. Read model: my_participations(); get_my_event_access() re-created
--     (DROP + CREATE in this transaction, same arguments, same ACL) with one more
--     column replay_url and a gl_guest branch; its legacy branch keeps its
--     rules and ignores core_v2 events (every current answer is unchanged).
--     "Proven" everywhere = profiles.email_proven_at set AND profiles.email (the
--     address it was stamped for) = auth.users.email.
-- 13. gl_checkin_v2() (gl_checkin untouched, md5-checked).
-- 14. admin_save_event(jsonb), admin_clone_event(uuid, jsonb). events.access_level
--     is always 'public' for core_v2 events (gl_event.access gates registration
--     only). Publishing a core_v2 event needs registration flag webinar_v2 /
--     onsite_v2 (the old main site would send visitors to a missing page).
-- 14b. Two guards on legacy tables, inert for every existing event:
--     event_registrations_engine_guard (BEFORE INSERT OR UPDATE OF event_id ON
--     event_registrations): no legacy registration on a core_v2 event (RLS
--     path and the service-role guest-webinar-register alike);
--     events_publish_guard (BEFORE INSERT OR UPDATE OF published ON events):
--     a core_v2 event becomes published only while its flag is on.
-- 15. invoke_registration_cron(text) + 3 pg_cron jobs calling the
--     registration-cron edge function with the Vault service key. Each call is
--     skipped in SQL unless its flag is on (and, for provisioning, unless there
--     is work: a queued job, a failed one to retry, or an account e-mail due in
--     the last 7 days and not sent), so nothing is called before the EDGE lane
--     deploys the function and the coordinator flips a flag.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WYS (wys26, guest_list_v1) keeps working exactly
-- ════════════════════════════════════════════════════════════════════════════
--   tokens untouched (no UPDATE of gl_guest.token; checkin_token stays NULL on
--   v1 rows, enforced); statuses and sources of v1 rows enforced to the legacy
--   sets; capacity rule unchanged (gl_seats_held counts confirmed + invited +
--   approved, and approved cannot exist on a v1 row); guest-list's select('*')
--   gets more keys, nothing it reads changes; gl_checkin untouched; the
--   provisioning trigger only INSERTs into account_provision_job and cannot fail
--   the guest-list write. requests_open of wys26 is not touched.
-- SM26: no sm_* row is written; my_participations() and the e-mail match read
-- sm_registration / sm_attendee / sm_role_assignment / sm_event only.
-- sm_autoclaim_by_email is NOT revoked (deviation from spec §4.7: the member
-- dashboard of the redesign uses it to show Smart Marina participation). It is
-- the one remaining writer of sm_registration.user_id keyed on an UNPROVEN auth
-- e-mail (outside this migration; see docs/registration-contract.md §9).
-- partner_requests: untouched (another lane).
--
-- Old live client (main): no visible change. It never writes the frozen profile
-- columns (its profile writes are first/last name, job title, onboarding status
-- and an insert of user_id/persona/statuses/job title), reads
-- get_my_event_access by column name, and does not call the new functions.
-- Only effect: a new account no longer auto-links a legacy webinar guest row
-- typed with the same, unproven address (trg_link_guest_registrations dropped;
-- the proof-based attach replaces it). The two guards of 14b act only on
-- core_v2 events, which main never creates.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select conname from pg_constraint where conrelid = 'public.gl_event'::regclass and conname = 'gl_event_door_matches_engine';  -> 1 row
--   select slug, engine, kind, registration_mode, door_token, account_email_timing, requests_open, hidden from gl_event order by slug;
--     -> canary-onsite guest_list_v1 onsite invitation shared with_confirmation f t
--        canary-v2     core_v2 webinar instant separate with_confirmation f t
--        wys26         guest_list_v1 onsite invitation shared with_confirmation t f
--   select status, source, count(*) from gl_guest group by 1, 2;     -> only legacy values
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
--     -> on_auth_user_created, on_auth_user_email_changed, on_auth_user_email_confirmed
--   select tgrelid::regclass, tgname from pg_trigger where tgname in ('event_registrations_engine_guard', 'events_publish_guard');  -> 2 rows
--   select jobname, schedule from cron.job where jobname like 'registration-cron-%';   -> 3 jobs
--   scripts/contract/sm26-snapshot.sql before and after: core tables identical.
-- Dry run: supabase/dryrun/20261009210000_registration_core.dryrun.sql
-- Undo:    supabase/migrations/down/20261009210000_registration_core.down.sql

-- ─── 0. Timeouts and preconditions ──────────────────────────────────────────
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  r record;
  v_md5 text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'gl_event' and column_name = 'hidden') then
    raise exception 'registration_core: apply 20261009200000_registration_prereqs first (gl_event.hidden is missing)';
  end if;

  -- Replaced bodies: the reviewed one, or this file's own (re-run). gl_checkin
  -- must stay byte-identical (gl_checkin_v2 is a separate function).
  for r in
    select * from (values
      ('public.get_my_event_access(uuid[])', 'd02afdef0bb982e128b33da6d03025be', '067870bb68772a8b5792b7d826714dd2'),
      ('public.prevent_profile_privilege_escalation()', 'e29979e16e96d0552bfae5474e909c76', '282c96e21016508d996f7d1124ce5093'),
      ('public.gl_checkin(uuid, uuid, uuid, boolean)', 'e2a63a98dcb1f5625b24d71f0cda3a62', 'e2a63a98dcb1f5625b24d71f0cda3a62')
    ) v(fn, reviewed_md5, patched_md5)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = r.fn::regprocedure;
    if v_md5 is distinct from r.reviewed_md5 and v_md5 is distinct from r.patched_md5 then
      raise exception 'registration_core: % changed since 9 Oct 2026 (md5 %); re-read it with pg_get_functiondef and rebuild this migration', r.fn, v_md5;
    end if;
  end loop;

  if exists (select 1 from pg_trigger t
              where t.tgrelid = 'public.profiles'::regclass
                and t.tgname = 'trg_link_guest_registrations'
                and t.tgfoid <> 'public.link_guest_registrations_on_profile_insert()'::regprocedure) then
    raise exception 'registration_core: trg_link_guest_registrations now calls another function; review it before dropping';
  end if;

  if exists (select 1 from public.gl_guest
              where status not in ('requested', 'invited', 'confirmed', 'declined', 'rejected', 'cancelled')
                 or source not in ('request', 'invitation', 'plus_one')) then
    raise exception 'registration_core: gl_guest holds a status or source outside the legacy sets; review before widening';
  end if;

  if exists (select 1 from public.gl_event where legacy_event_id is not null
              group by legacy_event_id having count(*) > 1) then
    raise exception 'registration_core: two gl_event rows share a legacy_event_id';
  end if;
end
$pre$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. gl_event: how each event takes registrations
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.gl_event
  add column if not exists engine text
    constraint gl_event_engine_check check (engine in ('guest_list_v1', 'core_v2'))
    not null default 'guest_list_v1',
  add column if not exists kind text
    constraint gl_event_kind_check check (kind in ('webinar', 'onsite'))
    not null default 'onsite',
  add column if not exists registration_mode text
    constraint gl_event_registration_mode_check check (registration_mode in ('instant', 'review', 'invitation'))
    not null default 'invitation',
  add column if not exists public_requests boolean not null default true,
  add column if not exists access text
    constraint gl_event_access_check check (access in ('public', 'members'))
    not null default 'public',
  add column if not exists opens_at timestamptz,
  add column if not exists closes_at timestamptz,
  add column if not exists edit_locks_at timestamptz,
  add column if not exists waitlist boolean not null default false,
  add column if not exists plus_ones smallint
    constraint gl_event_plus_ones_check check (plus_ones between 0 and 1)
    not null default 0,
  add column if not exists standard_fields jsonb
    constraint gl_event_standard_fields_check check (jsonb_typeof(standard_fields) = 'object')
    not null default '{}'::jsonb,
  add column if not exists account_email_timing text
    constraint gl_event_account_email_timing_check check (account_email_timing in ('with_confirmation', 'after_event'))
    not null default 'with_confirmation',
  add column if not exists account_email_send_at timestamptz,
  add column if not exists meeting_url text,
  add column if not exists replay_url text,
  add column if not exists reminders jsonb
    constraint gl_event_reminders_check check (jsonb_typeof(reminders) = 'array')
    not null default '[]'::jsonb,
  add column if not exists door_token text
    constraint gl_event_door_token_check check (door_token in ('shared', 'separate'))
    not null default 'shared',
  add column if not exists staff_alert_mode text
    constraint gl_event_staff_alert_mode_check check (staff_alert_mode in ('each', 'digest'))
    not null default 'each',
  add column if not exists updated_at timestamptz not null default now();

do $c$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.gl_event'::regclass and conname = 'gl_event_instant_is_webinar') then
    alter table public.gl_event add constraint gl_event_instant_is_webinar
      check (registration_mode <> 'instant' or kind = 'webinar');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.gl_event'::regclass and conname = 'gl_event_v2_no_legacy_requests') then
    alter table public.gl_event add constraint gl_event_v2_no_legacy_requests
      check (engine = 'guest_list_v1' or requests_open = false);
  end if;
  -- The door follows the engine: the WYS QR (gl_guest.token) is always admitted
  -- on a guest_list_v1 event, and a core_v2 gl_guest.token is never a pass (it
  -- is also the key of guest-list's public guest / rsvp / plus_one actions).
  if not exists (select 1 from pg_constraint where conrelid = 'public.gl_event'::regclass and conname = 'gl_event_door_matches_engine') then
    alter table public.gl_event add constraint gl_event_door_matches_engine
      check ((engine = 'guest_list_v1' and door_token = 'shared') or (engine = 'core_v2' and door_token = 'separate'));
  end if;
end
$c$;

create unique index if not exists gl_event_legacy_event_uq
  on public.gl_event (legacy_event_id) where legacy_event_id is not null;

comment on column public.gl_event.engine is 'guest_list_v1 = served by the guest-list edge function (wys26, canary-onsite); core_v2 = every new event, served by the registration edge function.';
comment on column public.gl_event.kind is 'webinar | onsite. Written only by admin_save_event (kept in step with events.event_type).';
comment on column public.gl_event.registration_mode is 'instant (webinars only) | review (M3 validates) | invitation (+ public_requests).';
comment on column public.gl_event.meeting_url is 'Webinar join link. Staff-only (RLS); served to confirmed registrants by get_my_event_access and the registration function. Never stored in events.meeting_url for core_v2 events.';
comment on column public.gl_event.replay_url is 'Replay link for registrants (events.replay_url stays the public one).';
comment on column public.gl_event.reminders is 'ISO-8601 durations before the start, e.g. ["P1D","PT1H"] (webinar) or ["P7D"] (on-site).';
comment on column public.gl_event.door_token is 'shared = the QR carries gl_guest.token (guest_list_v1, always); separate = it carries gl_guest.checkin_token (core_v2, always). CHECK gl_event_door_matches_engine.';
comment on column public.gl_event.standard_fields is '{company, job_title, phone, country}: required | optional | hidden. Missing key = optional.';

-- Backfill. wys26: today's behaviour, account e-mail sent at confirmation.
update public.gl_event
   set engine = 'guest_list_v1', kind = 'onsite', registration_mode = 'invitation', public_requests = true,
       access = 'public', door_token = 'shared', account_email_timing = 'with_confirmation'
 where slug = 'wys26';
-- canary-v2: the core_v2 webinar canary (prereqs created it closed and hidden).
update public.gl_event
   set engine = 'core_v2', kind = 'webinar', registration_mode = 'instant', door_token = 'separate',
       requests_open = false, reminders = '["P1D", "PT1H"]'::jsonb, updated_at = now()
 where slug = 'canary-v2' and legacy_event_id is null and engine = 'guest_list_v1';

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. gl_ticket and gl_question
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.gl_ticket (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.gl_event(id) on delete cascade,
  key text not null constraint gl_ticket_key_check check (key ~ '^[a-z0-9_]{1,40}$'),
  label text not null,
  description text,
  price_cents integer constraint gl_ticket_price_check check (price_cents is null or price_cents >= 0),
  currency text not null default 'EUR',
  price_note text,
  invite_only boolean not null default false,
  capacity integer constraint gl_ticket_capacity_check check (capacity is null or capacity >= 0),
  allowed_company_types text[],
  parts text[],
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, key)
);
comment on table public.gl_ticket is 'Participation types of a registration event (spec 3.2). A webinar usually has none (implicit attendee). Staff only; the public reads them through the registration function.';

create table if not exists public.gl_question (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.gl_event(id) on delete cascade,
  key text not null constraint gl_question_key_check check (key ~ '^[a-z0-9_]{1,40}$'),
  label text not null,
  help text,
  kind text not null constraint gl_question_kind_check check (kind in (
    'text', 'textarea', 'select', 'multiselect', 'checkbox', 'url', 'phone',
    'country', 'sectors', 'parts', 'consent')),
  options jsonb,
  max_length integer constraint gl_question_max_length_check check (max_length is null or max_length between 1 and 10000),
  required boolean not null default false,
  ticket_keys text[],
  profile_field text constraint gl_question_profile_field_check check (profile_field in ('job_title', 'country', 'phone', 'linkedin_url')),
  editable_after_submit boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, key)
);
comment on table public.gl_question is 'The event''s own questions (spec 3.3). Answers live in gl_guest.answers keyed by gl_question.key. Staff only.';

alter table public.gl_ticket enable row level security;
alter table public.gl_question enable row level security;
drop policy if exists gl_ticket_staff on public.gl_ticket;
create policy gl_ticket_staff on public.gl_ticket for all using (public.is_moderator()) with check (public.is_moderator());
drop policy if exists gl_question_staff on public.gl_question;
create policy gl_question_staff on public.gl_question for all using (public.is_moderator()) with check (public.is_moderator());

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. gl_guest additions
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.gl_guest
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists ticket_key text,
  add column if not exists answers jsonb not null default '{}'::jsonb,
  add column if not exists consents jsonb not null default '{}'::jsonb,
  add column if not exists source_detail jsonb not null default '{}'::jsonb,
  add column if not exists payment_status text
    constraint gl_guest_payment_status_check check (payment_status in ('none', 'due', 'pending', 'invoiced', 'paid', 'waived', 'refunded'))
    not null default 'none',
  add column if not exists amount_cents integer,
  add column if not exists currency text,
  add column if not exists checkin_token uuid constraint gl_guest_checkin_token_key unique,
  add column if not exists info_request text,
  add column if not exists info_requested_at timestamptz,
  add column if not exists link_opened_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists reminders_sent jsonb not null default '{}'::jsonb,
  add column if not exists account_action text
    constraint gl_guest_account_action_check check (account_action in ('linked', 'created', 'pending_link', 'skipped')),
  add column if not exists provisioned_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.gl_guest drop constraint if exists gl_guest_status_check;
alter table public.gl_guest add constraint gl_guest_status_check check (status in (
  'requested', 'needs_info', 'waitlisted', 'invited', 'approved', 'confirmed', 'declined', 'rejected', 'cancelled'));
alter table public.gl_guest drop constraint if exists gl_guest_source_check;
alter table public.gl_guest add constraint gl_guest_source_check check (source in (
  'request', 'invitation', 'plus_one', 'registration'));

create unique index if not exists gl_guest_event_user_uq on public.gl_guest (event_id, user_id) where user_id is not null;
create index if not exists gl_guest_user_idx on public.gl_guest (user_id) where user_id is not null;
create index if not exists gl_guest_email_lower_idx on public.gl_guest (lower(email));
-- kept: gl_guest_event_email unique (event_id, lower(email)); gl_guest_token_key unique (token)

comment on column public.gl_guest.token is 'guest_list_v1: the personal link /{slug}/guest?t= AND the door QR (never change). core_v2: never shown; the status link is a gl_access_token, the door QR is checkin_token.';
comment on column public.gl_guest.checkin_token is 'core_v2 door QR, minted by gl_guest_engine_guard when the row becomes confirmed on a door_token = separate event. Always NULL on guest_list_v1 rows.';
comment on column public.gl_guest.link_opened_at is 'First opening of a status link. A queue signal only, never e-mail proof.';
comment on column public.gl_guest.account_action is 'Set by provisioning: linked | created | pending_link | skipped.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. gl_access_token: hashed status links (core_v2)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.gl_access_token (
  token_hash bytea primary key,
  guest_id uuid not null references public.gl_guest(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists gl_access_token_guest_idx on public.gl_access_token (guest_id);
alter table public.gl_access_token enable row level security;
-- No policy: service role only.
revoke all on table public.gl_access_token from anon, authenticated;
comment on table public.gl_access_token is 'sha256(raw token) of core_v2 status links (/registration?t=). The raw token exists only in the e-mail. Service role only. Mint with gl_issue_access_token, read with gl_resolve_access_token.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. account_provision_job: the provisioning outbox
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.account_provision_job (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null constraint account_provision_job_source_kind_check check (source_kind in ('gl_guest', 'staff')),
  source_id uuid,
  email text not null,
  payload jsonb not null default '{}'::jsonb,
  org_action jsonb not null default '{"mode": "none"}'::jsonb,
  validate_person boolean not null default true,
  status text not null default 'queued'
    constraint account_provision_job_status_check check (status in ('queued', 'done', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text,
  email_due_at timestamptz,
  email_sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create unique index if not exists account_provision_job_source_uq
  on public.account_provision_job (source_kind, source_id) where source_id is not null;
create index if not exists account_provision_job_status_idx on public.account_provision_job (status, email_due_at);
alter table public.account_provision_job enable row level security;
drop policy if exists account_provision_job_staff_read on public.account_provision_job;
create policy account_provision_job_staff_read on public.account_provision_job
  for select to authenticated using (public.is_moderator());
revoke all on table public.account_provision_job from anon;
revoke insert, update, delete, truncate on table public.account_provision_job from authenticated;
comment on table public.account_provision_job is 'Provisioning outbox (spec 3.6). Queued by gl_guest_queue_provisioning when an on-site registration becomes confirmed; processed by provision-person (service role). Staff read only.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. review_log
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.review_log (
  id bigint generated always as identity primary key,
  subject_type text not null
    constraint review_log_subject_type_check check (subject_type in ('person', 'company', 'registration', 'claim', 'join', 'merge')),
  subject_id uuid not null,
  action text not null,
  note text,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists review_log_subject_idx on public.review_log (subject_type, subject_id, created_at desc);
alter table public.review_log enable row level security;
drop policy if exists review_log_staff_read on public.review_log;
create policy review_log_staff_read on public.review_log
  for select to authenticated using (public.is_moderator());
revoke all on table public.review_log from anon;
revoke insert, update, delete, truncate on table public.review_log from authenticated;
comment on table public.review_log is 'One row per M3 queue decision (spec 3.7). Staff read; written by review_log_add(), SECURITY DEFINER RPCs and the service role. Columns actor_id / created_at = the spec''s "by" / "at".';

create or replace function public.review_log_add(p_subject_type text, p_subject_id uuid, p_action text,
                                                 p_note text default null, p_details jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id bigint;
begin
  if not public.is_moderator() then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values (p_subject_type, p_subject_id, left(btrim(p_action), 60), nullif(left(btrim(coalesce(p_note, '')), 4000), ''),
          case when jsonb_typeof(p_details) = 'object' then p_details else '{}'::jsonb end, auth.uid())
  returning id into v_id;
  return v_id;
end
$function$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. People: profile columns, interest sectors, the profile guard
-- ═════════════════════════════════════════════════════════════════════════════
-- signup_source is added with DEFAULT 'legacy' and the default is dropped right
-- after: every existing profile reads 'legacy' (no row is rewritten, no trigger
-- fires, updated_at unchanged) and new profiles start NULL.
alter table public.profiles
  add column if not exists country text constraint profiles_country_len check (char_length(country) <= 80),
  add column if not exists phone text constraint profiles_phone_len check (char_length(phone) <= 40),
  add column if not exists linkedin_url text constraint profiles_linkedin_url_len check (char_length(linkedin_url) <= 300),
  add column if not exists affiliation text constraint profiles_affiliation_len check (char_length(affiliation) <= 200),
  add column if not exists signup_source text
    constraint profiles_signup_source_check check (signup_source in ('account', 'webinar', 'onsite', 'invitation', 'provisioned', 'legacy'))
    default 'legacy',
  add column if not exists signup_intent jsonb,
  add column if not exists email_proven_at timestamptz,
  add column if not exists email_changed_at timestamptz;
alter table public.profiles alter column signup_source drop default;

comment on column public.profiles.email is 'Read-only copy of auth.users.email, synced by on_auth_user_email_changed. Frozen against direct API writes.';
comment on column public.profiles.email_proven_at is 'When the person proved they read the current address (spec 5). Set only by trusted server code. Never by a status-link open or attach.';
comment on column public.profiles.email_changed_at is 'Last change of auth.users.email; an e-mail-link session older than this proves nothing.';
comment on column public.profiles.signup_intent is 'Phase 2: {action: join|new|none, org_id, name, website, country, type, code_matched}. Never store a raw claim code here (profiles are readable by co-members).';

create table if not exists public.profile_interest_sectors (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  sector_id uuid not null references public.sectors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sector_id)
);
alter table public.profile_interest_sectors enable row level security;
drop policy if exists profile_interest_sectors_select on public.profile_interest_sectors;
create policy profile_interest_sectors_select on public.profile_interest_sectors
  for select to authenticated using (user_id = (select auth.uid()) or public.is_moderator());
drop policy if exists profile_interest_sectors_insert on public.profile_interest_sectors;
create policy profile_interest_sectors_insert on public.profile_interest_sectors
  for insert to authenticated with check (user_id = (select auth.uid()) or public.is_moderator());
drop policy if exists profile_interest_sectors_delete on public.profile_interest_sectors;
create policy profile_interest_sectors_delete on public.profile_interest_sectors
  for delete to authenticated using (user_id = (select auth.uid()) or public.is_moderator());
revoke all on table public.profile_interest_sectors from anon;
comment on table public.profile_interest_sectors is 'Sectors of interest of a person (sign-up, up to 5 in the UI). Own rows plus staff.';

-- The guard: exact current body (md5 e29979e16e96d0552bfae5474e909c76) plus block 1b.
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
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

  -- 1b. Registration identity (20261009210000_registration_core): the e-mail
  --     copy, the e-mail proof and the sign-up record are written only by trusted
  --     server code (auth.users triggers, mark_email_proven, provisioning, staff
  --     RPCs). A direct API write by anyone but a verified admin keeps the stored
  --     values, silently, like 1. On INSERT they start empty and the e-mail is the
  --     caller's own (JWT).
  IF v_api_write AND NOT public.is_admin() THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.email            := OLD.email;
      NEW.email_proven_at  := OLD.email_proven_at;
      NEW.email_changed_at := OLD.email_changed_at;
      NEW.signup_source    := OLD.signup_source;
      NEW.signup_intent    := OLD.signup_intent;
    ELSIF TG_OP = 'INSERT' THEN
      NEW.email            := coalesce(nullif(auth.jwt() ->> 'email', ''), NEW.email);
      NEW.email_proven_at  := NULL;
      NEW.email_changed_at := NULL;
      NEW.signup_source    := NULL;
      NEW.signup_intent    := NULL;
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

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. Rate-limit scope (registration function); the guest-webinar-register rows keep scope NULL
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.guest_signup_rate_limits add column if not exists scope text;
create index if not exists idx_guest_rate_scope_email on public.guest_signup_rate_limits (scope, email_hash, created_at desc);
create index if not exists idx_guest_rate_scope_ip on public.guest_signup_rate_limits (scope, ip_hash, created_at desc);
comment on column public.guest_signup_rate_limits.scope is 'Action that wrote the row (registration function: reg_register, reg_resend, ...). NULL = guest-webinar-register. Rows are deleted after 24 h by cleanup_guest_rate_limits.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. Helpers
-- ═════════════════════════════════════════════════════════════════════════════

-- A text that may or may not be a timestamp (gl_event.settings of canaries).
create or replace function public.gl_try_ts(p text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $function$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  return p::timestamptz;
exception when others then
  return null;
end
$function$;

-- Start and effective end of a registration event. Dates live in public.events
-- (legacy_event_id); an event without a catalogue row (the canaries) reads
-- settings.starts_at / settings.ends_at. ends_at is never null when the start
-- is known: end, else start + 1 day (full day) or + 2 hours.
create or replace function public.gl_event_window(p_gl_event_id uuid, out starts_at timestamptz, out ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(e.date_time, public.gl_try_ts(g.settings ->> 'starts_at')),
         coalesce(e.end_date_time,
                  public.gl_try_ts(g.settings ->> 'ends_at'),
                  e.date_time + case when coalesce(e.is_full_day, false) then interval '1 day' else interval '2 hours' end,
                  public.gl_try_ts(g.settings ->> 'starts_at') + interval '2 hours')
    from public.gl_event g
    left join public.events e on e.id = g.legacy_event_id
   where g.id = p_gl_event_id
$function$;

-- Seats held (spec 4.1): confirmed + invited + approved. On a guest_list_v1 event
-- this is exactly guest-list's rule (confirmed + invited): approved cannot exist there.
create or replace function public.gl_seats_held(p_gl_event_id uuid, p_ticket_key text default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select count(*)::integer
    from public.gl_guest g
   where g.event_id = p_gl_event_id
     and g.status in ('confirmed', 'invited', 'approved')
     and (p_ticket_key is null or g.ticket_key = p_ticket_key)
$function$;

-- What a visitor (or a signed-in person, or an e-mail) can do on an event now.
create or replace function public.gl_registration_state(p_gl_event_id uuid, p_user_id uuid default null, p_email text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  ev public.gl_event;
  w record;
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_verified boolean := false;
  v_mine_id uuid;
  v_mine_status text;
  v_held integer;
  v_state text;
  v_published boolean;
begin
  select * into ev from public.gl_event where id = p_gl_event_id;
  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
  select * into w from public.gl_event_window(ev.id);
  -- A draft of the editor (catalogue row not published, event not hidden) takes
  -- no registration. Hidden events (canaries, tests) are reachable by link.
  if ev.legacy_event_id is not null then
    select e.published into v_published from public.events e where e.id = ev.legacy_event_id;
  end if;

  if p_user_id is not null then
    -- Signed in: the auth e-mail is the person's address.
    select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
    select (p.access_status = 'verified') into v_verified from public.profiles p where p.user_id = p_user_id;
  end if;

  select g.id, g.status into v_mine_id, v_mine_status
    from public.gl_guest g
   where g.event_id = ev.id
     and ((p_user_id is not null and g.user_id = p_user_id)
          or (v_email is not null and lower(g.email) = v_email))
   order by (g.user_id is not distinct from p_user_id) desc, g.created_at
   limit 1;

  v_held := public.gl_seats_held(ev.id);

  v_state := case
    when v_mine_id is not null and v_mine_status not in ('cancelled', 'declined') then 'registered'
    when ev.engine = 'guest_list_v1' then case when ev.requests_open then 'open' else 'closed' end
    when ev.legacy_event_id is not null and not ev.hidden and not coalesce(v_published, true) then 'not_published'
    when ev.opens_at is not null and now() < ev.opens_at then 'not_yet_open'
    when now() > coalesce(ev.closes_at, w.ends_at, 'infinity'::timestamptz) then 'closed'
    when ev.access = 'members' and not coalesce(v_verified, false) then 'members_only'
    when ev.registration_mode = 'invitation' and not ev.public_requests then 'invitation_only'
    when ev.registration_mode = 'instant' and ev.capacity is not null and v_held >= ev.capacity
      then case when ev.waitlist then 'waitlist' else 'full' end
    else 'open'
  end;

  return jsonb_build_object(
    'state', v_state,
    'engine', ev.engine, 'kind', ev.kind, 'mode', ev.registration_mode, 'access', ev.access,
    'capacity', ev.capacity, 'seats_held', v_held,
    'starts_at', w.starts_at, 'ends_at', w.ends_at,
    'opens_at', ev.opens_at, 'closes_at', coalesce(ev.closes_at, w.ends_at),
    'my_guest_id', v_mine_id, 'my_status', v_mine_status);
end
$function$;

-- Atomic core_v2 registration (spec 4.1 "register", core_v2 path). The event row
-- is locked, so capacity holds under concurrent sign-ups. Never returns a token.
create or replace function public.gl_register_v2(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  ev public.gl_event;
  v_user uuid;
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_first text := left(btrim(coalesce(p ->> 'first_name', '')), 80);
  v_last text := left(btrim(coalesce(p ->> 'last_name', '')), 80);
  v_company text := nullif(left(btrim(coalesce(p ->> 'company', '')), 160), '');
  v_job text := nullif(left(btrim(coalesce(p ->> 'job_title', '')), 160), '');
  v_phone text := nullif(left(btrim(coalesce(p ->> 'phone', '')), 40), '');
  v_country text := nullif(left(btrim(coalesce(p ->> 'country', '')), 80), '');
  v_org uuid;
  v_state jsonb;
  v_ticket public.gl_ticket;
  v_ticket_key text := nullif(btrim(coalesce(p ->> 'ticket_key', '')), '');
  v_n_tickets integer;
  v_existing public.gl_guest;
  v_status text;
  v_source text;
  v_answers jsonb := '{}'::jsonb;
  v_bad text[] := '{}';
  q record;
  v_val jsonb;
  v_id uuid;
  v_sf jsonb;
  v_missing text[] := '{}';
  v_pf_first text;
  v_pf_last text;
  v_pf_job text;
  v_pf_phone text;
  v_pf_country text;
  v_pf_status text;
  v_org_name text;
  v_consents jsonb;
  v_source_detail jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  -- Public input stored as is: only the known keys, short scalar values.
  --   consents      {terms_at, image, marketing_at}
  --   source_detail {entry, ref, utm_source, utm_medium, utm_campaign, utm_term, utm_content}
  select coalesce(jsonb_object_agg(c.key, case when jsonb_typeof(c.value) = 'string'
                                                then to_jsonb(left(c.value #>> '{}', 100)) else c.value end), '{}'::jsonb)
    into v_consents
    from jsonb_each(case when jsonb_typeof(p -> 'consents') = 'object' then p -> 'consents' else '{}'::jsonb end) c
   where c.key in ('terms_at', 'image', 'marketing_at')
     and jsonb_typeof(c.value) in ('string', 'boolean');
  select coalesce(jsonb_object_agg(s.key, to_jsonb(left(s.value #>> '{}', 200))), '{}'::jsonb)
    into v_source_detail
    from jsonb_each(case when jsonb_typeof(p -> 'source_detail') = 'object' then p -> 'source_detail' else '{}'::jsonb end) s
   where s.key in ('entry', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content')
     and jsonb_typeof(s.value) = 'string';
  begin
    v_user := nullif(p ->> 'user_id', '')::uuid;
    v_org := nullif(p ->> 'organization_id', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end;

  begin
    select * into ev from public.gl_event where id = nullif(p ->> 'gl_event_id', '')::uuid for update;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end;
  if ev.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if ev.engine <> 'core_v2' then
    return jsonb_build_object('ok', false, 'error', 'wrong_engine');
  end if;

  -- Signed in: the auth e-mail is forced. Empty fields come from the profile
  -- (names, job title, phone, country) and the company name from the person's
  -- company, so a one-click registration still fills what the event requires.
  if v_user is not null then
    select lower(u.email) into v_email from auth.users u where u.id = v_user;
    if v_email is null then
      return jsonb_build_object('ok', false, 'error', 'unknown_user');
    end if;
    select left(btrim(coalesce(pr.first_name, '')), 80), left(btrim(coalesce(pr.last_name, '')), 80),
           nullif(left(btrim(coalesce(pr.job_title, '')), 160), ''),
           nullif(left(btrim(coalesce(pr.phone, '')), 40), ''),
           nullif(left(btrim(coalesce(pr.country, '')), 80), ''),
           pr.access_status::text
      into v_pf_first, v_pf_last, v_pf_job, v_pf_phone, v_pf_country, v_pf_status
      from public.profiles pr where pr.user_id = v_user;
    -- A suspended account has no capability (spec 9), registration included.
    if v_pf_status = 'suspended' then
      return jsonb_build_object('ok', false, 'error', 'account_suspended');
    end if;
    -- A company is linked only if the person belongs to it.
    if v_org is not null and not exists (select 1 from public.organization_members m
                                          where m.organization_id = v_org and m.user_id = v_user) then
      v_org := null;
    end if;
    if v_org is not null then
      select nullif(left(btrim(o.name), 160), '') into v_org_name from public.organizations o where o.id = v_org;
    elsif (select count(*) from public.organization_members m where m.user_id = v_user) = 1 then
      select nullif(left(btrim(o.name), 160), '') into v_org_name
        from public.organization_members m join public.organizations o on o.id = m.organization_id
       where m.user_id = v_user;
    end if;
    if v_first = '' then v_first := coalesce(v_pf_first, ''); end if;
    if v_last = '' then v_last := coalesce(v_pf_last, ''); end if;
    v_job := coalesce(v_job, v_pf_job);
    v_phone := coalesce(v_phone, v_pf_phone);
    v_country := coalesce(v_country, v_pf_country);
    v_company := coalesce(v_company, v_org_name);
  else
    v_org := null;
  end if;

  if length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@.]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  -- The event's standard fields (gl_event.standard_fields): a hidden field is
  -- never stored, a required one must be there. Missing key = optional.
  v_sf := case when jsonb_typeof(ev.standard_fields) = 'object' then ev.standard_fields else '{}'::jsonb end;
  if v_sf ->> 'company' = 'hidden' then v_company := null; end if;
  if v_sf ->> 'job_title' = 'hidden' then v_job := null; end if;
  if v_sf ->> 'phone' = 'hidden' then v_phone := null; end if;
  if v_sf ->> 'country' = 'hidden' then v_country := null; end if;
  if v_first = '' then v_missing := array_append(v_missing, 'first_name'::text); end if;
  if v_last = '' then v_missing := array_append(v_missing, 'last_name'::text); end if;
  if v_sf ->> 'company' = 'required' and v_company is null then v_missing := array_append(v_missing, 'company'::text); end if;
  if v_sf ->> 'job_title' = 'required' and v_job is null then v_missing := array_append(v_missing, 'job_title'::text); end if;
  if v_sf ->> 'phone' = 'required' and v_phone is null then v_missing := array_append(v_missing, 'phone'::text); end if;
  if v_sf ->> 'country' = 'required' and v_country is null then v_missing := array_append(v_missing, 'country'::text); end if;
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_fields', 'fields', to_jsonb(v_missing));
  end if;

  -- One registration per person per event: (event, e-mail) or (event, account).
  select * into v_existing
    from public.gl_guest g
   where g.event_id = ev.id
     and (lower(g.email) = v_email or (v_user is not null and g.user_id = v_user))
   order by (g.user_id is not distinct from v_user) desc, g.created_at
   limit 1;
  if v_existing.id is not null and v_existing.status not in ('cancelled', 'declined') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'guest_id', v_existing.id, 'status', v_existing.status);
  end if;

  v_state := public.gl_registration_state(ev.id, v_user, v_email);
  if v_state ->> 'state' in ('not_published', 'not_yet_open', 'closed', 'members_only', 'invitation_only') then
    return jsonb_build_object('ok', false, 'state', v_state ->> 'state');
  end if;

  -- Ticket (participation type).
  select count(*) into v_n_tickets from public.gl_ticket t where t.event_id = ev.id and t.active;
  if v_n_tickets > 0 then
    if v_ticket_key is null and v_n_tickets = 1 then
      select t.key into v_ticket_key from public.gl_ticket t where t.event_id = ev.id and t.active;
    end if;
    select * into v_ticket from public.gl_ticket t
     where t.event_id = ev.id and t.key = v_ticket_key and t.active;
    if v_ticket.id is null then
      return jsonb_build_object('ok', false, 'error', 'ticket_required');
    end if;
    if v_ticket.invite_only then
      return jsonb_build_object('ok', false, 'error', 'ticket_invite_only');
    end if;
    if coalesce(cardinality(v_ticket.allowed_company_types), 0) > 0
       and not exists (select 1
                         from public.organization_members m
                         join public.organizations o on o.id = m.organization_id
                        where v_user is not null
                          and m.user_id = v_user
                          and o.access_status = 'verified'
                          and o.organization_type = any (v_ticket.allowed_company_types)) then
      return jsonb_build_object('ok', false, 'error', 'ticket_not_allowed');
    end if;
  elsif v_ticket_key is not null then
    return jsonb_build_object('ok', false, 'error', 'unknown_ticket');
  end if;

  -- Answers: only this event's questions (for this ticket), shapes checked,
  -- unknown keys dropped. Missing required or malformed -> invalid_answers.
  for q in
    select qq.key, qq.kind, qq.options, qq.max_length, qq.required
      from public.gl_question qq
     where qq.event_id = ev.id
       and (coalesce(cardinality(qq.ticket_keys), 0) = 0 or v_ticket_key = any (qq.ticket_keys))
     order by qq.display_order, qq.key
  loop
    v_val := p -> 'answers' -> q.key;
    if v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb or v_val = '[]'::jsonb
       or (q.kind in ('checkbox', 'consent') and v_val = 'false'::jsonb) then
      if q.required then v_bad := v_bad || q.key; end if;
      continue;
    end if;
    if q.kind in ('checkbox', 'consent') then
      if jsonb_typeof(v_val) <> 'boolean' then v_bad := v_bad || q.key; continue; end if;
    elsif q.kind in ('multiselect', 'sectors', 'parts') then
      if jsonb_typeof(v_val) <> 'array'
         or exists (select 1 from jsonb_array_elements(v_val) a where jsonb_typeof(a) <> 'string') then
        v_bad := v_bad || q.key; continue;
      end if;
      if q.kind in ('multiselect', 'parts') and jsonb_typeof(q.options) = 'array'
         and exists (select 1 from jsonb_array_elements_text(v_val) a(v)
                      where not exists (select 1 from jsonb_array_elements(q.options) o
                                         where coalesce(o ->> 'value', o #>> '{}') = a.v)) then
        v_bad := v_bad || q.key; continue;
      end if;
    else
      if jsonb_typeof(v_val) <> 'string' then v_bad := v_bad || q.key; continue; end if;
      v_val := to_jsonb(left(v_val #>> '{}', coalesce(q.max_length, case when q.kind = 'textarea' then 4000 else 500 end)));
      if q.kind = 'select' and jsonb_typeof(q.options) = 'array'
         and not exists (select 1 from jsonb_array_elements(q.options) o
                          where coalesce(o ->> 'value', o #>> '{}') = v_val #>> '{}') then
        v_bad := v_bad || q.key; continue;
      end if;
    end if;
    v_answers := v_answers || jsonb_build_object(q.key, v_val);
  end loop;
  if cardinality(v_bad) > 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_answers', 'keys', to_jsonb(v_bad));
  end if;

  -- Status from the mode (and the capacity, for instant registration).
  if ev.registration_mode = 'instant' then
    if (ev.capacity is not null and public.gl_seats_held(ev.id) >= ev.capacity)
       or (v_ticket.capacity is not null and public.gl_seats_held(ev.id, v_ticket.key) >= v_ticket.capacity) then
      if ev.waitlist then
        v_status := 'waitlisted';
      else
        return jsonb_build_object('ok', false, 'state', 'full');
      end if;
    else
      v_status := 'confirmed';
    end if;
    v_source := 'registration';
  elsif ev.registration_mode = 'review' then
    v_status := 'requested';
    v_source := 'registration';
  else
    -- invitation mode with public_requests (the state check refused the rest)
    v_status := 'requested';
    v_source := 'request';
  end if;

  if v_existing.id is not null then
    -- A cancelled or declined registration comes back to life (same row, same tokens).
    update public.gl_guest g
       set status = v_status,
           user_id = coalesce(g.user_id, v_user),
           organization_id = coalesce(v_org, g.organization_id),
           first_name = v_first, last_name = v_last,
           company = v_company, job_title = v_job, phone = v_phone, country = v_country,
           ticket_key = v_ticket_key, answers = v_answers,
           consents = v_consents,
           source_detail = case when v_source_detail <> '{}'::jsonb then v_source_detail else g.source_detail end,
           cancelled_at = null, responded_at = null, decided_at = null, decided_by = null,
           info_request = null, info_requested_at = null,
           -- a new registration: reminders and the first-opening signal start over
           reminders_sent = '{}'::jsonb, link_opened_at = null
     where g.id = v_existing.id
     returning g.id into v_id;
  else
    insert into public.gl_guest (event_id, source, status, first_name, last_name, email, phone, company, job_title, country,
                                 user_id, organization_id, ticket_key, answers, consents, source_detail)
    values (ev.id, v_source, v_status, v_first, v_last, v_email, v_phone, v_company, v_job, v_country,
            v_user, v_org, v_ticket_key, v_answers, v_consents, v_source_detail)
    returning id into v_id;
  end if;

  -- Written back to the signed-in person's profile when the profile field is empty.
  if v_user is not null then
    with pf as (
      select qq.profile_field as f, v_answers ->> qq.key as v
        from public.gl_question qq
       where qq.event_id = ev.id and qq.profile_field is not null and v_answers ? qq.key
    )
    update public.profiles pr
       set job_title    = coalesce(nullif(pr.job_title, ''), v_job, (select left(v, 160) from pf where f = 'job_title' limit 1)),
           country      = coalesce(nullif(pr.country, ''), v_country, (select left(v, 80) from pf where f = 'country' limit 1)),
           phone        = coalesce(nullif(pr.phone, ''), v_phone, (select left(v, 40) from pf where f = 'phone' limit 1)),
           linkedin_url = coalesce(nullif(pr.linkedin_url, ''), (select left(v, 300) from pf where f = 'linkedin_url' limit 1))
     where pr.user_id = v_user
       and (nullif(pr.job_title, '') is null or nullif(pr.country, '') is null
            or nullif(pr.phone, '') is null or nullif(pr.linkedin_url, '') is null);
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'reactivated', v_existing.id is not null,
                            'guest_id', v_id, 'status', v_status);
end
$function$;

-- Atomic staff decision on core_v2 registrations (spec 4.1 "decide"). The
-- registration function calls it with the service role once it has checked the
-- staff session; p_actor is that staff member (checked again here). ONE
-- transaction: the event row is locked (capacity holds against concurrent
-- approvals and registrations), the statuses change (the guard mints
-- checkin_token, the provisioning trigger queues the job), the staff choices
-- are stored on the jobs this decision queued BEFORE anything can process them,
-- and one review_log row is written per changed registration. Sends no e-mail:
-- the caller e-mails the rows listed in "changed".
create or replace function public.gl_decide_v2(
  p_gl_event_id uuid,
  p_guest_ids uuid[],
  p_decision text,
  p_actor uuid,
  p_org_action jsonb default '{"mode": "none"}'::jsonb,
  p_validate_person boolean default true,
  p_force boolean default false,
  p_info_request text default null,
  p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  ev public.gl_event;
  v_from text[];
  v_to text;
  v_ids uuid[];
  v_changed uuid[];
  v_held integer;
  v_jobs integer := 0;
  v_info text := nullif(left(btrim(coalesce(p_info_request, '')), 2000), '');
  v_mode text;
  t record;
begin
  if p_decision is null or p_decision not in ('approve', 'reject', 'waitlist', 'request_info') then
    return jsonb_build_object('ok', false, 'error', 'bad_decision');
  end if;
  if p_guest_ids is null or cardinality(p_guest_ids) = 0 or cardinality(p_guest_ids) > 200 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  if p_actor is null or not exists (select 1 from public.profiles pr
                                     where pr.user_id = p_actor
                                       and pr.persona in ('admin', 'moderator')
                                       and pr.access_status = 'verified') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- {mode: none|link|create, org_id, type, name, website, country, as_owner}
  v_mode := case when jsonb_typeof(p_org_action) = 'object' then coalesce(p_org_action ->> 'mode', '') else '' end;
  if v_mode not in ('none', 'link', 'create') then
    return jsonb_build_object('ok', false, 'error', 'bad_org_action');
  end if;
  if v_mode = 'link' then
    begin
      if not exists (select 1 from public.organizations o where o.id = (p_org_action ->> 'org_id')::uuid) then
        return jsonb_build_object('ok', false, 'error', 'bad_org_action');
      end if;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'bad_org_action');
    end;
  elsif v_mode = 'create' and coalesce(btrim(p_org_action ->> 'name'), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_org_action');
  end if;
  if p_decision = 'request_info' and v_info is null then
    return jsonb_build_object('ok', false, 'error', 'info_request_required');
  end if;

  select * into ev from public.gl_event where id = p_gl_event_id for update;
  if ev.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if ev.engine <> 'core_v2' then
    return jsonb_build_object('ok', false, 'error', 'wrong_engine');
  end if;

  v_from := case p_decision
              when 'approve' then array['requested', 'needs_info', 'waitlisted']
              when 'reject' then array['requested', 'needs_info', 'waitlisted']
              when 'waitlist' then array['requested', 'needs_info']
              else array['requested', 'waitlisted'] end;
  v_to := case p_decision
            when 'approve' then 'confirmed'
            when 'reject' then 'rejected'
            when 'waitlist' then 'waitlisted'
            else 'needs_info' end;

  select coalesce(array_agg(x.id), '{}') into v_ids
    from (select g.id from public.gl_guest g
           where g.event_id = ev.id and g.id = any (p_guest_ids) and g.status = any (v_from)
           order by g.created_at
           for update) x;

  -- Capacity (spec 4.1: seats held = confirmed + invited + approved), event and
  -- tickets. p_force = staff chose to go over.
  if p_decision = 'approve' and not coalesce(p_force, false) and cardinality(v_ids) > 0 then
    v_held := public.gl_seats_held(ev.id);
    if ev.capacity is not null and v_held + cardinality(v_ids) > ev.capacity then
      return jsonb_build_object('ok', false, 'error', 'capacity', 'held', v_held,
                                'capacity', ev.capacity, 'adding', cardinality(v_ids));
    end if;
    for t in
      select k.ticket_key, count(*)::integer as adding, tk.capacity
        from public.gl_guest k
        join public.gl_ticket tk on tk.event_id = ev.id and tk.key = k.ticket_key
       where k.id = any (v_ids) and tk.capacity is not null
       group by k.ticket_key, tk.capacity
    loop
      v_held := public.gl_seats_held(ev.id, t.ticket_key);
      if v_held + t.adding > t.capacity then
        return jsonb_build_object('ok', false, 'error', 'ticket_capacity', 'ticket_key', t.ticket_key,
                                  'held', v_held, 'capacity', t.capacity, 'adding', t.adding);
      end if;
    end loop;
  end if;

  with up as (
    update public.gl_guest g
       set status = v_to,
           decided_at = now(),
           decided_by = p_actor,
           info_request = case when v_to = 'needs_info' then v_info else g.info_request end,
           info_requested_at = case when v_to = 'needs_info' then now() else g.info_requested_at end
     where g.id = any (v_ids) and g.status = any (v_from)
    returning g.id
  )
  select coalesce(array_agg(up.id), '{}') into v_changed from up;

  -- The provisioning trigger queued the jobs of on-site confirmations with the
  -- defaults; the staff choices land on them in this same transaction.
  if v_to = 'confirmed' and cardinality(v_changed) > 0 then
    update public.account_provision_job j
       set org_action = p_org_action,
           validate_person = coalesce(p_validate_person, true),
           created_by = p_actor
     where j.source_kind = 'gl_guest' and j.source_id = any (v_changed) and j.status = 'queued';
    get diagnostics v_jobs = row_count;
  end if;

  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  select 'registration', x.id, p_decision, nullif(left(btrim(coalesce(p_note, '')), 4000), ''),
         jsonb_strip_nulls(jsonb_build_object(
           'gl_event_id', ev.id, 'status', v_to,
           'org_action', case when v_to = 'confirmed' then p_org_action end,
           'validate_person', case when v_to = 'confirmed' then coalesce(p_validate_person, true) end,
           'forced', case when coalesce(p_force, false) then true end,
           'info_request', case when v_to = 'needs_info' then v_info end)),
         p_actor
    from unnest(v_changed) as x(id);

  return jsonb_build_object('ok', true, 'decision', p_decision, 'status', v_to,
                            'changed', to_jsonb(v_changed),
                            'skipped', to_jsonb(array(select u from unnest(p_guest_ids) u where u <> all (v_changed))),
                            'jobs', v_jobs);
end
$function$;

-- Status links (core_v2 only). Returns the RAW token once; only its sha256 is stored.
create or replace function public.gl_issue_access_token(p_guest_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_engine text;
  v_event uuid;
  v_starts timestamptz;
  v_ends timestamptz;
  v_raw text;
begin
  select e.engine, e.id into v_engine, v_event
    from public.gl_guest g join public.gl_event e on e.id = g.event_id
   where g.id = p_guest_id;
  if v_engine is null then
    raise exception using errcode = '22023', message = 'guest_not_found';
  end if;
  if v_engine <> 'core_v2' then
    raise exception using errcode = '22023', message = 'wrong_engine';
  end if;
  select w.starts_at, w.ends_at into v_starts, v_ends from public.gl_event_window(v_event) w;
  -- 32 random bytes, base64url without padding (43 characters).
  v_raw := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.gl_access_token (token_hash, guest_id, expires_at)
  values (extensions.digest(v_raw, 'sha256'), p_guest_id,
          greatest(now(), coalesce(v_ends, v_starts, now())) + interval '30 days');
  return v_raw;
end
$function$;

-- Raw token -> guest id (null when unknown, revoked or expired). p_touch stamps
-- last_used_at and, on the first opening, gl_guest.link_opened_at.
create or replace function public.gl_resolve_access_token(p_token text, p_touch boolean default true)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_hash bytea;
  v_guest uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then
    return null;
  end if;
  v_hash := extensions.digest(p_token, 'sha256');
  select t.guest_id into v_guest
    from public.gl_access_token t
   where t.token_hash = v_hash and t.revoked_at is null and t.expires_at > now();
  if v_guest is not null and p_touch then
    update public.gl_access_token set last_used_at = now() where token_hash = v_hash;
    update public.gl_guest set link_opened_at = now() where id = v_guest and link_opened_at is null;
  end if;
  return v_guest;
end
$function$;

-- Open and upcoming registration events for the public chooser (/signup/event,
-- event cards). Hidden events and unpublished catalogue rows are left out.
create or replace function public.public_registration_events()
returns table (gl_event_id uuid, event_id uuid, slug text, engine text, kind text, registration_mode text,
               access text, title text, starts_at timestamptz, ends_at timestamptz, location text,
               image_url text, state text)
language sql
stable
security definer
set search_path = ''
as $function$
  select g.id, g.legacy_event_id, g.slug, g.engine, g.kind, g.registration_mode, g.access,
         coalesce(e.title, g.title), w.starts_at, w.ends_at, e.location, e.image_url,
         public.gl_registration_state(g.id) ->> 'state'
    from public.gl_event g
    join public.events e on e.id = g.legacy_event_id
    cross join lateral public.gl_event_window(g.id) w
   where not g.hidden
     and coalesce(e.published, true)
     and coalesce(w.ends_at, w.starts_at, now()) >= now()
   order by w.starts_at nulls last, g.slug
$function$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. Triggers on gl_guest
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_guest_engine_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_engine text;
  v_mode text;
  v_door text;
  v_plus smallint;
begin
  select e.engine, e.registration_mode, e.door_token, e.plus_ones into v_engine, v_mode, v_door, v_plus
    from public.gl_event e where e.id = new.event_id;

  if v_engine = 'guest_list_v1' then
    -- The WYS guest list: exactly the values guest-list knows.
    if new.status not in ('requested', 'invited', 'confirmed', 'declined', 'rejected', 'cancelled') then
      raise exception using errcode = '23514',
        message = format('gl_guest_engine_guard: status %s is not allowed on a guest-list event', new.status);
    end if;
    if new.source not in ('request', 'invitation', 'plus_one') then
      raise exception using errcode = '23514',
        message = format('gl_guest_engine_guard: source %s is not allowed on a guest-list event', new.source);
    end if;
    if new.checkin_token is not null then
      raise exception using errcode = '23514',
        message = 'gl_guest_engine_guard: a guest-list event uses gl_guest.token at the door, not checkin_token';
    end if;
    -- gl_guest.token is the personal link AND the door QR here, and
    -- my_participations() shows it to the linked account: a NEW row is linked
    -- only to the account that PROVED this row's address (Confirm email is off:
    -- anyone can sign up with someone else's address). Otherwise user_id is
    -- dropped, silently; attach (token link, or proof) links it later.
    if tg_op = 'INSERT' and new.user_id is not null
       and not exists (select 1 from public.profiles p join auth.users u on u.id = p.user_id
                        where p.user_id = new.user_id
                          and p.email_proven_at is not null
                          and lower(p.email) = lower(u.email)
                          and lower(u.email) = lower(btrim(new.email))) then
      new.user_id := null;
    end if;
  elsif v_engine = 'core_v2' then
    -- Checked on the value being written only: an existing 'request' row stays
    -- editable (decisions, door, cancel, attach, account deletion) after staff
    -- move the event out of invitation mode.
    if new.source = 'request' and v_mode <> 'invitation'
       and (tg_op = 'INSERT' or old.source is distinct from 'request') then
      raise exception using errcode = '23514',
        message = 'gl_guest_engine_guard: source request is only for invitation-mode events';
    end if;
    -- A new plus-one only where the event allows plus-ones (guest-list's public
    -- plus_one action knows nothing of core_v2). Existing rows stay editable.
    if new.source = 'plus_one' and coalesce(v_plus, 0) = 0 then
      if tg_op = 'INSERT' then
        raise exception using errcode = '23514',
          message = 'gl_guest_engine_guard: this event does not take plus-ones';
      elsif old.source is distinct from 'plus_one' then
        raise exception using errcode = '23514',
          message = 'gl_guest_engine_guard: this event does not take plus-ones';
      end if;
    end if;
    -- The door pass is minted when the row becomes confirmed.
    if new.status = 'confirmed' and v_door = 'separate' and new.checkin_token is null then
      new.checkin_token := gen_random_uuid();
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'cancelled' and new.cancelled_at is null then
      new.cancelled_at := now();
    end if;
  else
    if new.status = 'cancelled' and new.cancelled_at is null and old.status is distinct from 'cancelled' then
      new.cancelled_at := now();
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$function$;

drop trigger if exists gl_guest_engine_guard on public.gl_guest;
create trigger gl_guest_engine_guard
  before insert or update on public.gl_guest
  for each row execute function public.gl_guest_engine_guard();

create or replace function public.gl_guest_queue_provisioning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_kind text;
  v_timing text;
  v_send_at timestamptz;
  v_slug text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_due timestamptz;
begin
  if tg_op = 'UPDATE' then
    if old.status = 'confirmed' then
      return null;
    end if;
  end if;
  -- Never abort the write that fired this (guest-list among others).
  begin
    select e.kind, e.account_email_timing, e.account_email_send_at, e.slug
      into v_kind, v_timing, v_send_at, v_slug
      from public.gl_event e where e.id = new.event_id;
    if v_kind is distinct from 'onsite' then
      return null;
    end if;
    select w.starts_at, w.ends_at into v_starts, v_ends from public.gl_event_window(new.event_id) w;
    v_due := case when v_timing = 'after_event'
                  then coalesce(v_send_at, v_ends + interval '1 day', now())
                  else now() end;
    insert into public.account_provision_job as j (source_kind, source_id, email, payload, email_due_at)
    values ('gl_guest', new.id, lower(btrim(new.email)),
            jsonb_build_object(
              'first_name', new.first_name, 'last_name', new.last_name,
              'job_title', new.job_title, 'country', new.country, 'phone', new.phone,
              'company', new.company, 'gl_event_id', new.event_id, 'event_slug', v_slug,
              'guest_user_id', new.user_id),
            v_due)
    -- A registration confirmed AGAIN (declined then accepted, cancelled then
    -- re-approved, reactivated) whose job was skipped (no longer confirmed when
    -- provision-person looked) or failed is queued again with fresh data and the
    -- default choices (gl_decide_v2 then stores the staff choices). A job that is
    -- queued or done is left alone.
    on conflict (source_kind, source_id) where source_id is not null do update
       set status = 'queued', attempts = 0, last_error = null, done_at = null, email_sent_at = null,
           email = excluded.email, payload = excluded.payload, email_due_at = excluded.email_due_at,
           org_action = '{"mode": "none"}'::jsonb, validate_person = true, created_by = null
     where j.status in ('skipped', 'failed');
  exception when others then
    raise warning 'gl_guest_queue_provisioning(%): % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end
$function$;

drop trigger if exists gl_guest_queue_provisioning on public.gl_guest;
create trigger gl_guest_queue_provisioning
  after insert or update of status on public.gl_guest
  for each row
  when (new.status = 'confirmed')
  execute function public.gl_guest_queue_provisioning();

-- Backfill: rows already confirmed on an on-site event (a wys26 guest approved
-- before this migration) get the job the trigger would have queued. Same payload
-- and due date as the trigger; idempotent. 0 rows on 9 Oct (3 wys26 requests).
insert into public.account_provision_job (source_kind, source_id, email, payload, email_due_at)
select 'gl_guest', g.id, lower(btrim(g.email)),
       jsonb_build_object(
         'first_name', g.first_name, 'last_name', g.last_name,
         'job_title', g.job_title, 'country', g.country, 'phone', g.phone,
         'company', g.company, 'gl_event_id', g.event_id, 'event_slug', e.slug,
         'guest_user_id', g.user_id),
       case when e.account_email_timing = 'after_event'
            then coalesce(e.account_email_send_at, w.ends_at + interval '1 day', now())
            else now() end
  from public.gl_guest g
  join public.gl_event e on e.id = g.event_id
  cross join lateral public.gl_event_window(e.id) w
 where e.kind = 'onsite' and g.status = 'confirmed'
on conflict (source_kind, source_id) where source_id is not null do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- 11. Identity: e-mail proof and attach
-- ═════════════════════════════════════════════════════════════════════════════

-- Phase 2 replaces this body (signup_intent: join / claim / new company). Same
-- signature and return type; until then it does nothing.
create or replace function public.complete_signup_for(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object('done', false, 'reason', 'not_built_yet')
$function$;

-- Links the unclaimed registrations sent to the person's PROVEN address:
-- gl_guest rows and legacy event_registrations guest rows. Never sm_*.
create or replace function public.attach_my_records_for(p_user_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_email text;
  v_proven timestamptz;
  v_proven_for text;
  v_gl integer := 0;
  v_legacy integer := 0;
begin
  -- Proven = email_proven_at set AND profiles.email (the address the proof was
  -- stamped for; synced by the auth triggers) still equals the auth e-mail.
  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  select pr.email_proven_at, lower(pr.email) into v_proven, v_proven_for from public.profiles pr where pr.user_id = p_user_id;
  if v_email is null or v_proven is null or v_proven_for is distinct from v_email then
    return 0;
  end if;

  update public.gl_guest g
     set user_id = p_user_id,
         account_action = case when g.account_action = 'pending_link' then 'linked' else g.account_action end
   where g.user_id is null
     and lower(g.email) = v_email
     and not exists (select 1 from public.gl_guest g2 where g2.event_id = g.event_id and g2.user_id = p_user_id);
  get diagnostics v_gl = row_count;

  update public.event_registrations r
     set user_id = p_user_id
   where r.user_id is null
     and r.guest_email is not null
     and lower(r.guest_email) = v_email
     and not exists (select 1 from public.event_registrations r2 where r2.event_id = r.event_id and r2.user_id = p_user_id);
  get diagnostics v_legacy = row_count;

  return v_gl + v_legacy;
end
$function$;

create or replace function public.attach_my_records()
returns integer
language sql
volatile
security definer
set search_path = ''
as $function$
  select case when auth.uid() is null then 0 else public.attach_my_records_for(auth.uid()) end
$function$;

-- The person proved they read the current address: stamp (and bring
-- profiles.email in line with it), then attach and finish sign-up. The stamp is
-- kept even when attach or complete_signup fails (each runs in its own block).
create or replace function public.on_email_proven(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attached integer := 0;
  v_signup jsonb;
begin
  update public.profiles pr
     set email_proven_at = now(),
         email = u.email
    from auth.users u
   where pr.user_id = p_user_id
     and u.id = pr.user_id
     and u.email is not null
     and (pr.email_proven_at is null or lower(coalesce(pr.email, '')) <> lower(u.email));
  begin
    v_attached := public.attach_my_records_for(p_user_id);
  exception when others then
    raise warning 'on_email_proven(%): attach failed: % (%)', p_user_id, sqlerrm, sqlstate;
  end;
  begin
    v_signup := public.complete_signup_for(p_user_id);
  exception when others then
    raise warning 'on_email_proven(%): complete_signup failed: % (%)', p_user_id, sqlerrm, sqlstate;
    v_signup := jsonb_build_object('done', false, 'reason', 'error');
  end;
  return jsonb_build_object('proven', true, 'attached', v_attached, 'signup', v_signup);
end
$function$;

-- Called by /welcome, /reset-password and /verify-email as soon as the page
-- opens: stamps proof when THIS session was opened from an auth e-mail link (JWT
-- amr) less than 15 minutes ago, after the last e-mail change, and not by an
-- admin's "view as user".
create or replace function public.mark_email_proven()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_amr jsonb := auth.jwt() -> 'amr';
  v_link_at timestamptz;
  v_changed timestamptz;
  v_proven timestamptz;
  v_proven_for text;
  v_out jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_signed_in';
  end if;
  select pr.email_proven_at, pr.email_changed_at, lower(pr.email) into v_proven, v_changed, v_proven_for
    from public.profiles pr where pr.user_id = v_uid;
  if not found then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'no_profile');
  end if;

  -- Proven only for the current auth address (profiles.email = auth e-mail).
  if v_proven is not null
     and v_proven_for is not distinct from (select lower(u.email) from auth.users u where u.id = v_uid) then
    return jsonb_build_object('proven', true, 'stamped', false,
                              'attached', public.attach_my_records_for(v_uid));
  end if;

  select max(to_timestamp((a ->> 'timestamp')::double precision)) into v_link_at
    from jsonb_array_elements(case when jsonb_typeof(v_amr) = 'array' then v_amr else '[]'::jsonb end) a
   where a ->> 'method' in ('otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change')
     and (a ->> 'timestamp') ~ '^[0-9]+([.][0-9]+)?$';

  if v_link_at is null then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'no_email_link_session');
  end if;
  if v_changed is not null and v_link_at < v_changed then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'email_changed_since');
  end if;
  -- Only a FRESH link session proves the current address: the pages call this
  -- right after the click. An older session (amr entries live as long as the
  -- session) may predate an e-mail change made before this migration, which
  -- email_changed_at does not know about.
  if v_link_at < now() - interval '15 minutes' then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'link_session_too_old');
  end if;
  -- An admin "view as user" session is opened from a magic link a few seconds
  -- after admin-impersonate logs it.
  if exists (select 1 from public.admin_impersonation_log l
              where l.target_user_id = v_uid
                and l.created_at between v_link_at - interval '5 minutes' and v_link_at + interval '1 minute') then
    return jsonb_build_object('proven', false, 'stamped', false, 'reason', 'impersonation');
  end if;

  v_out := public.on_email_proven(v_uid);
  return jsonb_build_object('proven', true, 'stamped', true, 'attached', v_out -> 'attached');
end
$function$;

-- auth.users: the address was confirmed by clicking a link that was SENT to it.
create or replace function public.on_auth_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  begin
    if new.email is not null
       and (old.confirmation_sent_at is not null or old.invited_at is not null or old.recovery_sent_at is not null)
       and not exists (select 1 from public.admin_impersonation_log l
                        where l.target_user_id = new.id and l.created_at > now() - interval '10 minutes') then
      perform public.on_email_proven(new.id);
    end if;
  exception when others then
    raise warning 'on_auth_email_confirmed(%): % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end
$function$;

-- auth.users: the address changed. profiles.email follows; the proof follows only
-- a change confirmed from the new inbox (secure e-mail change), else it is cleared.
create or replace function public.on_auth_email_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_proven boolean;
begin
  -- If this block fails, profiles.email keeps the OLD address, so any proof left
  -- in email_proven_at no longer counts (proven = profiles.email = auth e-mail).
  begin
    v_proven := old.email_change_sent_at is not null
                and nullif(old.email_change, '') is not null
                and lower(old.email_change) = lower(new.email);
    update public.profiles
       set email = new.email,
           email_changed_at = now(),
           email_proven_at = case when v_proven then now() else null end
     where user_id = new.id;
  exception when others then
    raise warning 'on_auth_email_changed(%): % (%)', new.id, sqlerrm, sqlstate;
  end;
  -- Separate block: a failing attach never undoes the profile update above.
  begin
    if v_proven then
      perform public.attach_my_records_for(new.id);
    end if;
  exception when others then
    raise warning 'on_auth_email_changed(%): attach failed: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end
$function$;

-- auth.users belongs to supabase_auth_admin: postgres holds the TRIGGER
-- privilege (enough to CREATE OR REPLACE a trigger) but cannot DROP one.
create or replace trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.on_auth_email_confirmed();

create or replace trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.on_auth_email_changed();

-- Unproven auto-link at sign-up: replaced by the proof-based attach above.
drop trigger if exists trg_link_guest_registrations on public.profiles;

-- ═════════════════════════════════════════════════════════════════════════════
-- 12. Read model
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.my_participations()
returns table (
  engine text, registration_id uuid, gl_event_id uuid, event_id uuid, slug text,
  title text, starts_at timestamptz, ends_at timestamptz, is_past boolean, kind text,
  location text, image_url text, role_or_ticket text,
  status text, status_display text, payment_display text,
  status_url text, can_cancel boolean, linked boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with me as (
    -- proven = the proof was stamped for the CURRENT auth address
    select u.id as uid, lower(u.email) as email,
           coalesce(pr.email_proven_at is not null and lower(pr.email) = lower(u.email), false) as proven
      from auth.users u
      left join public.profiles pr on pr.user_id = u.id
     where u.id = auth.uid()
  ),
  gl as (
    select ev.engine,
           g.id,
           ev.id as gl_event_id,
           ev.legacy_event_id,
           ev.slug,
           coalesce(e.title, ev.title) as title,
           w.starts_at,
           w.ends_at,
           coalesce(coalesce(w.ends_at, w.starts_at) < now(), false) as is_past,
           ev.kind,
           coalesce(e.location, ev.settings ->> 'venue') as location,
           coalesce(e.image_url, ev.settings ->> 'image_url') as image_url,
           case
             when t.label is not null then t.label
             when g.plus_one_of is not null then 'Plus-one'
             when ev.engine = 'guest_list_v1' then nullif(concat_ws(' + ',
               case when (case when g.status = 'confirmed' then g.conference else g.wants_conference end) then 'Conference' end,
               case when (case when g.status = 'confirmed' then g.gala else g.wants_gala end) then 'Gala dinner' end), '')
           end as role_or_ticket,
           g.status,
           case g.status
             when 'requested' then 'under_review'
             when 'needs_info' then 'needs_info'
             when 'waitlisted' then 'waitlisted'
             when 'invited' then 'invited'
             when 'approved' then 'payment_due'
             when 'confirmed' then 'confirmed'
             when 'rejected' then 'not_accepted'
             when 'declined' then 'declined'
             when 'cancelled' then 'cancelled'
           end as status_display,
           g.payment_status as payment_display,
           -- v1: the token is also the WYS door QR; shown only once the caller's
           -- address is proven (a user_id link alone may come from an account
           -- opened with someone else's address).
           case when ev.engine = 'guest_list_v1' and me.proven then '/' || ev.slug || '/guest?t=' || g.token::text end as status_url,
           ((w.starts_at is null or w.starts_at > now())
             and case when ev.engine = 'guest_list_v1' then g.status = 'requested'
                      else g.status in ('requested', 'needs_info', 'waitlisted', 'invited', 'approved', 'confirmed') end) as can_cancel,
           (g.user_id is not null) as linked
      from me
      join public.gl_guest g
        on g.user_id = me.uid
        or (me.proven and g.user_id is null and lower(g.email) = me.email)
      join public.gl_event ev on ev.id = g.event_id
      left join public.events e on e.id = ev.legacy_event_id
      left join public.gl_ticket t on t.event_id = g.event_id and t.key = g.ticket_key
      cross join lateral public.gl_event_window(ev.id) w
  ),
  legacy as (
    select 'legacy'::text,
           r.id,
           null::uuid,
           r.event_id,
           null::text,
           e.title,
           e.date_time,
           coalesce(e.end_date_time,
                    e.date_time + case when coalesce(e.is_full_day, false) then interval '1 day' else interval '2 hours' end),
           coalesce(coalesce(e.end_date_time,
                             e.date_time + case when coalesce(e.is_full_day, false) then interval '1 day' else interval '2 hours' end) < now(), false),
           case when e.event_type = 'webinar' then 'webinar' else 'onsite' end,
           e.location,
           e.image_url,
           r.registration_type,
           r.payment_status,
           case r.payment_status
             when 'pending_approval' then 'under_review'
             when 'free' then 'confirmed'
             when 'paid' then 'confirmed'
             else 'payment_due'
           end,
           case r.payment_status
             when 'paid' then 'paid'
             when 'invoice_sent' then 'invoiced'
             when 'pending_payment' then 'due'
             when 'pending_invoice' then 'due'
             else 'none'
           end,
           '/events/' || r.event_id::text,
           false,
           (r.user_id is not null)
      from me
      join public.event_registrations r
        on r.user_id = me.uid
        or (me.proven and r.user_id is null and lower(r.guest_email) = me.email)
      join public.events e on e.id = r.event_id
     -- a core_v2 event registers in gl_guest only (a legacy row there is refused
     -- by event_registrations_engine_guard and never counts)
     where not exists (select 1 from public.gl_event x where x.legacy_event_id = r.event_id and x.engine = 'core_v2')
  ),
  sm as (
    select 'sm26'::text,
           r.id,
           null::uuid,
           se.legacy_event_id,
           se.slug,
           se.name,
           (se.start_date::timestamp at time zone coalesce(se.timezone, 'Europe/Monaco')),
           ((coalesce(se.end_date, se.start_date) + 1)::timestamp at time zone coalesce(se.timezone, 'Europe/Monaco')),
           coalesce(((coalesce(se.end_date, se.start_date) + 1)::timestamp at time zone coalesce(se.timezone, 'Europe/Monaco')) < now(), false),
           'onsite'::text,
           se.venue,
           null::text,
           case when r.user_id = me.uid
                then (select string_agg(distinct ra.role, ', ' order by ra.role)
                        from public.sm_role_assignment ra
                       where ra.registration_id = r.id and ra.status <> 'declined')
                else 'Attendee' end,
           r.status,
           case r.status
             when 'confirmed' then 'confirmed'
             when 'waitlist' then 'waitlisted'
             when 'declined' then 'not_accepted'
             when 'cancelled' then 'cancelled'
             else case when ((coalesce(se.end_date, se.start_date) + 1)::timestamp at time zone coalesce(se.timezone, 'Europe/Monaco')) < now()
                       then 'event_ended' else 'under_review' end
           end,
           'none'::text,
           case when se.slug = 'sm26' then '/sm26/me' end,
           false,
           (r.user_id is not null)
      from me
      join public.sm_registration r on true
      join public.sm_event se on se.id = r.event_id
     where r.user_id = me.uid
        or exists (select 1 from public.sm_attendee a
                    where a.registration_id = r.id
                      and a.attending
                      and (a.user_id = me.uid or (me.proven and lower(a.email) = me.email)))
  )
  select * from gl
  union all
  select * from legacy
  union all
  select * from sm
  order by 7 desc nulls last
$function$;

-- get_my_event_access: same arguments, one more column (replay_url). The legacy
-- branch (event_registrations) keeps its rules and ignores core_v2 events (none
-- has a catalogue row today: every current answer is unchanged, dry run S15); a
-- gl_guest branch is added.
-- DROP + CREATE because the return type changes; same ACL re-granted below.
drop function if exists public.get_my_event_access(uuid[]);
CREATE FUNCTION public.get_my_event_access(p_event_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(event_id uuid, is_registered boolean, meeting_url text, replay_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select auth.uid() as uid,
           public.is_moderator() as staff,
           -- guest rows count as mine only for a CONFIRMED auth e-mail
           (select lower(u.email)
              from auth.users u
             where u.id = auth.uid()
               and u.email_confirmed_at is not null) as email,
           -- registration core (20261009210000): a gl_guest row found by e-mail
           -- counts only once that e-mail is PROVEN (profiles.email_proven_at,
           -- stamped for the current address: profiles.email = auth e-mail)
           (select lower(u.email)
              from auth.users u
              join public.profiles p on p.user_id = u.id
             where u.id = auth.uid()
               and p.email_proven_at is not null
               and lower(p.email) = lower(u.email)) as proven_email
  ),
  mine as (
    select distinct r.event_id
      from public.event_registrations r
      join public.events e on e.id = r.event_id
      cross join me
     where me.uid is not null
       and (r.user_id = me.uid
            or (r.user_id is null
                and me.email is not null
                and lower(r.guest_email) = me.email))
       -- an invitation request is not a seat until staff approve it
       and not (coalesce(e.invitation_only, false) and r.payment_status = 'pending_approval')
       and (p_event_ids is null or r.event_id = any(p_event_ids))
       -- registration core: a core_v2 event registers in gl_guest only; a legacy
       -- row on it (refused since this migration) never counts
       and not exists (select 1 from public.gl_event x where x.legacy_event_id = r.event_id and x.engine = 'core_v2')
  ),
  -- registration core: a CONFIRMED gl_guest row of the caller on the event's
  -- registration (gl_event.legacy_event_id = events.id)
  gl_mine as (
    select distinct ev.legacy_event_id as event_id
      from public.gl_guest g
      join public.gl_event ev on ev.id = g.event_id
      cross join me
     where me.uid is not null
       and ev.legacy_event_id is not null
       and g.status = 'confirmed'
       and (g.user_id = me.uid
            or (g.user_id is null
                and me.proven_email is not null
                and lower(g.email) = me.proven_email))
       and (p_event_ids is null or ev.legacy_event_id = any(p_event_ids))
  )
  select e.id,
         (m.event_id is not null or gm.event_id is not null),
         case when m.event_id is not null or gm.event_id is not null or me.staff
              then coalesce(ge.meeting_url, e.meeting_url) end,
         case when m.event_id is not null or gm.event_id is not null or me.staff
              then ge.replay_url end
    from public.events e
    cross join me
    left join mine m on m.event_id = e.id
    left join gl_mine gm on gm.event_id = e.id
    left join public.gl_event ge on ge.legacy_event_id = e.id
   where me.uid is not null
     and (me.staff or gm.event_id is not null or public.can_access_resource(e.access_level))
     and case
           when p_event_ids is null then m.event_id is not null or gm.event_id is not null
           else e.id = any(p_event_ids) and (m.event_id is not null or gm.event_id is not null or me.staff)
         end;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 13. Door check-in for both engines (gl_checkin is untouched)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_checkin_v2(p_event_id uuid, p_token uuid default null, p_guest_id uuid default null, p_undo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  g public.gl_guest;
  v_door text;
begin
  if not public.is_moderator() then raise exception 'forbidden'; end if;
  select e.door_token into v_door from public.gl_event e where e.id = p_event_id;
  if v_door is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_token');
  end if;
  -- separate door: only checkin_token admits (gl_guest.token never does);
  -- shared door: gl_guest.token, exactly like gl_checkin.
  select * into g from public.gl_guest
   where event_id = p_event_id
     and ((p_token is not null
           and ((v_door = 'separate' and checkin_token = p_token)
                or (v_door = 'shared' and token = p_token)))
          or (p_guest_id is not null and id = p_guest_id));
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_token'); end if;
  if p_undo then
    update public.gl_guest set checked_in_at = null, checked_in_by = null where id = g.id;
    return jsonb_build_object('ok', true, 'undone', true, 'guest_id', g.id);
  end if;
  if g.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error', 'status_' || g.status, 'guest_id', g.id,
      'name', g.first_name || ' ' || g.last_name, 'company', g.company);
  end if;
  if g.checked_in_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'guest_id', g.id, 'name', g.first_name || ' ' || g.last_name,
      'company', g.company, 'conference', g.conference, 'gala', g.gala, 'checked_in_at', g.checked_in_at,
      'plus_one', g.plus_one_of is not null, 'ticket_key', g.ticket_key);
  end if;
  update public.gl_guest set checked_in_at = now(), checked_in_by = auth.uid() where id = g.id;
  return jsonb_build_object('ok', true, 'guest_id', g.id, 'name', g.first_name || ' ' || g.last_name,
    'company', g.company, 'conference', g.conference, 'gala', g.gala, 'plus_one', g.plus_one_of is not null,
    'ticket_key', g.ticket_key);
end
$function$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 14. Event editor RPCs
-- ═════════════════════════════════════════════════════════════════════════════
-- admin_save_event(p): one transaction writes events + gl_event (+ gl_ticket,
-- gl_question when given). Partial saves: a key that is absent keeps the stored
-- value. Shape and error codes: docs/registration-contract.md.
create or replace function public.admin_save_event(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_ev jsonb := case when jsonb_typeof(p -> 'event') = 'object' then p -> 'event' else '{}'::jsonb end;
  v_rg jsonb := case when jsonb_typeof(p -> 'registration') = 'object' then p -> 'registration' else '{}'::jsonb end;
  v_id uuid;
  v_gl public.gl_event;
  v_event_id uuid;
  v_published boolean;
  v_slug text;
  v_title text;
  v_kind text;
  v_mode text;
  v_access text;
  v_hidden boolean;
  v_capacity integer;
  v_keys text[];
  v_publish boolean;
  v_flag text;
begin
  if not public.is_moderator() then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception using errcode = '22023', message = 'bad_input';
  end if;

  v_id := nullif(p ->> 'id', '')::uuid;
  if v_id is not null then
    select * into v_gl from public.gl_event where id = v_id for update;
    if v_gl.id is null then
      raise exception using errcode = '22023', message = 'event_not_found';
    end if;
    if v_gl.engine <> 'core_v2' then
      raise exception using errcode = '22023', message = 'guest_list_event',
        detail = 'This event runs on the guest list and is edited in its own admin page.';
    end if;
    v_event_id := v_gl.legacy_event_id;
  end if;

  -- Values after this save.
  v_slug := lower(btrim(coalesce(v_rg ->> 'slug', v_gl.slug, '')));
  v_kind := coalesce(nullif(v_rg ->> 'kind', ''), v_gl.kind, 'webinar');
  v_mode := coalesce(nullif(v_rg ->> 'registration_mode', ''), v_gl.registration_mode,
                     case when v_kind = 'webinar' then 'instant' else 'review' end);
  v_access := coalesce(nullif(v_rg ->> 'access', ''), v_gl.access, 'public');
  v_hidden := coalesce((v_rg ->> 'hidden')::boolean, v_gl.hidden, false);
  v_capacity := case when v_rg ? 'capacity' then nullif(v_rg ->> 'capacity', '')::integer else v_gl.capacity end;
  if v_event_id is not null then
    select e.title, e.published into v_title, v_published from public.events e where e.id = v_event_id;
  end if;
  v_title := coalesce(nullif(btrim(v_ev ->> 'title'), ''), v_title, v_gl.title);

  -- Checks, with codes the editor turns into words.
  if v_title is null then
    raise exception using errcode = '22023', message = 'title_required';
  end if;
  if v_slug = '' then
    raise exception using errcode = '22023', message = 'slug_required';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 60 then
    raise exception using errcode = '22023', message = 'slug_invalid';
  end if;
  if v_slug = any (array['sm26', 'wys26', 'admin', 'register', 'registration', 'signup', 'events', 'join', 'welcome']) then
    raise exception using errcode = '22023', message = 'slug_reserved';
  end if;
  if exists (select 1 from public.gl_event g where g.slug = v_slug and g.id is distinct from v_id)
     or exists (select 1 from public.sm_event s where s.slug = v_slug) then
    raise exception using errcode = '22023', message = 'slug_taken';
  end if;
  if v_gl.slug is not null and v_slug <> v_gl.slug and coalesce(v_published, false) then
    raise exception using errcode = '22023', message = 'slug_locked',
      detail = 'The web address cannot change once the event is published.';
  end if;
  if v_kind not in ('webinar', 'onsite') then
    raise exception using errcode = '22023', message = 'bad_kind';
  end if;
  if v_mode not in ('instant', 'review', 'invitation') then
    raise exception using errcode = '22023', message = 'bad_mode';
  end if;
  if v_mode = 'instant' and v_kind <> 'webinar' then
    raise exception using errcode = '22023', message = 'instant_needs_webinar';
  end if;
  if v_access not in ('public', 'members') then
    raise exception using errcode = '22023', message = 'bad_access';
  end if;
  if v_capacity is not null and v_capacity < 0 then
    raise exception using errcode = '22023', message = 'bad_capacity';
  end if;
  if v_rg ? 'standard_fields'
     and (jsonb_typeof(v_rg -> 'standard_fields') <> 'object'
          or exists (select 1 from jsonb_each_text(v_rg -> 'standard_fields') s
                      where s.key not in ('company', 'job_title', 'phone', 'country')
                         or s.value not in ('required', 'optional', 'hidden'))) then
    raise exception using errcode = '22023', message = 'bad_standard_fields';
  end if;
  if v_rg ? 'reminders' then
    if jsonb_typeof(v_rg -> 'reminders') <> 'array'
       or exists (select 1 from jsonb_array_elements(v_rg -> 'reminders') x
                   where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^P(T?[0-9]+[DHMW])+$|^P[0-9]+DT[0-9]+[HM]$') then
      raise exception using errcode = '22023', message = 'bad_reminders';
    end if;
  end if;

  -- Publishing waits for the new registration front: while flag webinar_v2
  -- (webinars) / onsite_v2 (on-site) is off, the old main site is live and sends
  -- visitors of an event with a gl_event slug to /{slug}, a page it does not
  -- have. Same rule for direct writes: events_publish_guard.
  v_publish := case when v_hidden then false
                    when v_ev ? 'published' then coalesce((v_ev ->> 'published')::boolean, false)
                    when v_event_id is null then false
                    else v_published end;
  if coalesce(v_publish, false) and not coalesce(v_published, false) then
    v_flag := case when v_kind = 'webinar' then 'webinar_v2' else 'onsite_v2' end;
    if not coalesce((select (ps.value ->> v_flag) = 'true' from public.platform_settings ps where ps.key = 'registration_flags'), false) then
      raise exception using errcode = '22023', message = 'publish_needs_flag',
        detail = format('Publishing waits for the new registration pages (flag %s).', v_flag);
    end if;
  end if;

  -- events: the public catalogue row. access_level stays 'public': the event page
  -- is visible to everyone; gl_event.access ('members' = verified person) gates
  -- the registration only (events.access_level 'members' would mean marketplace
  -- access in can_access_resource, a different audience).
  if v_event_id is null then
    insert into public.events (title, event_type, invitation_only, access_level, published, meeting_url)
    values (v_title, case when v_kind = 'webinar' then 'webinar' else 'on_site' end,
            v_mode = 'invitation', 'public', false, null)
    returning id into v_event_id;
  end if;
  update public.events e
     set title = v_title,
         description = case when v_ev ? 'description' then nullif(v_ev ->> 'description', '') else e.description end,
         date_time = case when v_ev ? 'date_time' then nullif(v_ev ->> 'date_time', '')::timestamptz else e.date_time end,
         end_date_time = case when v_ev ? 'end_date_time' then nullif(v_ev ->> 'end_date_time', '')::timestamptz else e.end_date_time end,
         is_full_day = case when v_ev ? 'is_full_day' then coalesce((v_ev ->> 'is_full_day')::boolean, false) else e.is_full_day end,
         location = case when v_ev ? 'location' then nullif(v_ev ->> 'location', '') else e.location end,
         location_details = case when v_ev ? 'location_details' then
                              case when jsonb_typeof(v_ev -> 'location_details') = 'object' then v_ev -> 'location_details' else '{}'::jsonb end
                            else e.location_details end,
         language = case when v_ev ? 'language' then coalesce(nullif(v_ev ->> 'language', ''), 'EN') else e.language end,
         speakers = case when v_ev ? 'speakers' then
                      case when jsonb_typeof(v_ev -> 'speakers') = 'array' then v_ev -> 'speakers' else '[]'::jsonb end
                    else e.speakers end,
         event_partners = case when v_ev ? 'event_partners' then
                            case when jsonb_typeof(v_ev -> 'event_partners') = 'array' then v_ev -> 'event_partners' else '[]'::jsonb end
                          else e.event_partners end,
         event_website_url = case when v_ev ? 'event_website_url' then nullif(v_ev ->> 'event_website_url', '') else e.event_website_url end,
         image_url = case when v_ev ? 'image_url' then nullif(v_ev ->> 'image_url', '') else e.image_url end,
         replay_url = case when v_ev ? 'replay_url' then nullif(v_ev ->> 'replay_url', '') else e.replay_url end,
         published = v_publish,
         event_type = case when v_kind = 'webinar' then 'webinar' else 'on_site' end,
         invitation_only = (v_mode = 'invitation'),
         access_level = 'public',
         max_attendance = v_capacity,
         -- The join link is never public: it lives in gl_event.meeting_url.
         meeting_url = null
   where e.id = v_event_id;

  -- gl_event: how people register.
  if v_id is null then
    insert into public.gl_event (slug, title, legacy_event_id, engine, kind, registration_mode, access, door_token,
                                 requests_open, hidden)
    values (v_slug, v_title, v_event_id, 'core_v2', v_kind, v_mode, v_access, 'separate', false, v_hidden)
    returning id into v_id;
  end if;
  update public.gl_event g
     set slug = v_slug,
         title = v_title,
         legacy_event_id = v_event_id,
         engine = 'core_v2',
         requests_open = false,
         kind = v_kind,
         registration_mode = v_mode,
         access = v_access,
         hidden = v_hidden,
         capacity = v_capacity,
         public_requests = case when v_rg ? 'public_requests' then coalesce((v_rg ->> 'public_requests')::boolean, true) else g.public_requests end,
         opens_at = case when v_rg ? 'opens_at' then nullif(v_rg ->> 'opens_at', '')::timestamptz else g.opens_at end,
         closes_at = case when v_rg ? 'closes_at' then nullif(v_rg ->> 'closes_at', '')::timestamptz else g.closes_at end,
         edit_locks_at = case when v_rg ? 'edit_locks_at' then nullif(v_rg ->> 'edit_locks_at', '')::timestamptz else g.edit_locks_at end,
         waitlist = case when v_rg ? 'waitlist' then coalesce((v_rg ->> 'waitlist')::boolean, false) else g.waitlist end,
         plus_ones = case when v_rg ? 'plus_ones' then coalesce(nullif(v_rg ->> 'plus_ones', '')::smallint, 0) else g.plus_ones end,
         standard_fields = case when v_rg ? 'standard_fields' then v_rg -> 'standard_fields' else g.standard_fields end,
         account_email_timing = case when v_rg ? 'account_email_timing'
                                     then coalesce(nullif(v_rg ->> 'account_email_timing', ''), 'with_confirmation')
                                     else g.account_email_timing end,
         account_email_send_at = case when v_rg ? 'account_email_send_at' then nullif(v_rg ->> 'account_email_send_at', '')::timestamptz else g.account_email_send_at end,
         meeting_url = case when v_rg ? 'meeting_url' then nullif(btrim(v_rg ->> 'meeting_url'), '') else g.meeting_url end,
         replay_url = case when v_rg ? 'replay_url' then nullif(btrim(v_rg ->> 'replay_url'), '') else g.replay_url end,
         reminders = case when v_rg ? 'reminders' then v_rg -> 'reminders' else g.reminders end,
         -- core_v2 always has its own door pass (CHECK gl_event_door_matches_engine)
         door_token = 'separate',
         staff_alert_mode = case when v_rg ? 'staff_alert_mode' then coalesce(nullif(v_rg ->> 'staff_alert_mode', ''), 'each') else g.staff_alert_mode end,
         notify_email = case when v_rg ? 'notify_email' then nullif(btrim(v_rg ->> 'notify_email'), '') else g.notify_email end,
         settings = case when jsonb_typeof(v_rg -> 'settings') = 'object' then g.settings || (v_rg -> 'settings') else g.settings end,
         updated_at = now()
   where g.id = v_id;

  -- Participation types: upsert by key; a type left out is deleted, or only
  -- switched off when someone already registered with it.
  if p ? 'tickets' then
    if jsonb_typeof(p -> 'tickets') <> 'array' then
      raise exception using errcode = '22023', message = 'bad_tickets';
    end if;
    select coalesce(array_agg(x ->> 'key'), '{}') into v_keys from jsonb_array_elements(p -> 'tickets') x;
    if exists (select 1 from unnest(v_keys) k where k is null or k !~ '^[a-z0-9_]{1,40}$') then
      raise exception using errcode = '22023', message = 'bad_ticket_key';
    end if;
    if cardinality(v_keys) <> (select count(distinct k) from unnest(v_keys) k) then
      raise exception using errcode = '22023', message = 'duplicate_ticket_key';
    end if;
    insert into public.gl_ticket as t (event_id, key, label, description, price_cents, currency, price_note,
                                       invite_only, capacity, allowed_company_types, parts, display_order, active)
    select v_id,
           a.x ->> 'key',
           coalesce(nullif(btrim(a.x ->> 'label'), ''), a.x ->> 'key'),
           nullif(a.x ->> 'description', ''),
           nullif(a.x ->> 'price_cents', '')::integer,
           coalesce(nullif(a.x ->> 'currency', ''), 'EUR'),
           nullif(a.x ->> 'price_note', ''),
           coalesce((a.x ->> 'invite_only')::boolean, false),
           nullif(a.x ->> 'capacity', '')::integer,
           case when jsonb_typeof(a.x -> 'allowed_company_types') = 'array'
                then array(select jsonb_array_elements_text(a.x -> 'allowed_company_types')) end,
           case when jsonb_typeof(a.x -> 'parts') = 'array'
                then array(select jsonb_array_elements_text(a.x -> 'parts')) end,
           coalesce(nullif(a.x ->> 'display_order', '')::integer, a.o::integer),
           coalesce((a.x ->> 'active')::boolean, true)
      from jsonb_array_elements(p -> 'tickets') with ordinality as a(x, o)
    on conflict (event_id, key) do update
       set label = excluded.label, description = excluded.description, price_cents = excluded.price_cents,
           currency = excluded.currency, price_note = excluded.price_note, invite_only = excluded.invite_only,
           capacity = excluded.capacity, allowed_company_types = excluded.allowed_company_types,
           parts = excluded.parts, display_order = excluded.display_order, active = excluded.active;
    update public.gl_ticket t set active = false
     where t.event_id = v_id and not (t.key = any (v_keys))
       and exists (select 1 from public.gl_guest g where g.event_id = v_id and g.ticket_key = t.key);
    delete from public.gl_ticket t
     where t.event_id = v_id and not (t.key = any (v_keys))
       and not exists (select 1 from public.gl_guest g where g.event_id = v_id and g.ticket_key = t.key);
  end if;

  -- Questions: upsert by key; a question left out is deleted (answers already
  -- given stay in gl_guest.answers).
  if p ? 'questions' then
    if jsonb_typeof(p -> 'questions') <> 'array' then
      raise exception using errcode = '22023', message = 'bad_questions';
    end if;
    select coalesce(array_agg(x ->> 'key'), '{}') into v_keys from jsonb_array_elements(p -> 'questions') x;
    if exists (select 1 from unnest(v_keys) k where k is null or k !~ '^[a-z0-9_]{1,40}$') then
      raise exception using errcode = '22023', message = 'bad_question_key';
    end if;
    if cardinality(v_keys) <> (select count(distinct k) from unnest(v_keys) k) then
      raise exception using errcode = '22023', message = 'duplicate_question_key';
    end if;
    insert into public.gl_question as q (event_id, key, label, help, kind, options, max_length, required,
                                         ticket_keys, profile_field, editable_after_submit, display_order)
    select v_id,
           a.x ->> 'key',
           coalesce(nullif(btrim(a.x ->> 'label'), ''), a.x ->> 'key'),
           nullif(a.x ->> 'help', ''),
           coalesce(nullif(a.x ->> 'kind', ''), 'text'),
           case when jsonb_typeof(a.x -> 'options') = 'array' then a.x -> 'options' end,
           nullif(a.x ->> 'max_length', '')::integer,
           coalesce((a.x ->> 'required')::boolean, false),
           case when jsonb_typeof(a.x -> 'ticket_keys') = 'array'
                then array(select jsonb_array_elements_text(a.x -> 'ticket_keys')) end,
           nullif(a.x ->> 'profile_field', ''),
           coalesce((a.x ->> 'editable_after_submit')::boolean, true),
           coalesce(nullif(a.x ->> 'display_order', '')::integer, a.o::integer)
      from jsonb_array_elements(p -> 'questions') with ordinality as a(x, o)
    on conflict (event_id, key) do update
       set label = excluded.label, help = excluded.help, kind = excluded.kind, options = excluded.options,
           max_length = excluded.max_length, required = excluded.required, ticket_keys = excluded.ticket_keys,
           profile_field = excluded.profile_field, editable_after_submit = excluded.editable_after_submit,
           display_order = excluded.display_order;
    delete from public.gl_question q where q.event_id = v_id and not (q.key = any (v_keys));
  end if;

  return jsonb_build_object('gl_event_id', v_id, 'event_id', v_event_id, 'slug', v_slug);
end
$function$;

-- admin_clone_event(src, overrides): copy of an event (either engine) as a new,
-- unpublished core_v2 event. overrides = {event:{...}, registration:{slug, ...}}
-- with the admin_save_event shape; registration.slug is required.
create or replace function public.admin_clone_event(p_src uuid, p_overrides jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  src public.gl_event;
  e public.events;
  v_o jsonb := case when jsonb_typeof(p_overrides) = 'object' then p_overrides else '{}'::jsonb end;
  v_ev jsonb;
  v_rg jsonb;
begin
  if not public.is_moderator() then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  select * into src from public.gl_event where id = p_src;
  if src.id is null then
    raise exception using errcode = '22023', message = 'event_not_found';
  end if;
  select * into e from public.events where id = src.legacy_event_id;

  v_ev := jsonb_strip_nulls(jsonb_build_object(
            'title', coalesce(e.title, src.title) || ' (copy)',
            'description', e.description, 'date_time', e.date_time, 'end_date_time', e.end_date_time,
            'is_full_day', e.is_full_day, 'location', e.location, 'location_details', e.location_details,
            'language', e.language, 'speakers', e.speakers, 'event_partners', e.event_partners,
            'event_website_url', e.event_website_url, 'image_url', e.image_url))
          || case when jsonb_typeof(v_o -> 'event') = 'object' then v_o -> 'event' else '{}'::jsonb end
          || jsonb_build_object('published', false);

  v_rg := jsonb_build_object(
            'kind', src.kind,
            'registration_mode', case when src.engine = 'guest_list_v1' then 'invitation' else src.registration_mode end,
            'public_requests', src.public_requests, 'access', src.access, 'capacity', src.capacity,
            'waitlist', src.waitlist, 'plus_ones', src.plus_ones, 'standard_fields', src.standard_fields,
            'account_email_timing', src.account_email_timing, 'reminders', src.reminders,
            'staff_alert_mode', src.staff_alert_mode,
            'notify_email', src.notify_email, 'hidden', src.hidden, 'settings', src.settings)
          || case when jsonb_typeof(v_o -> 'registration') = 'object' then v_o -> 'registration' else '{}'::jsonb end;

  if coalesce(btrim(v_rg ->> 'slug'), '') = '' then
    raise exception using errcode = '22023', message = 'slug_required';
  end if;

  return public.admin_save_event(jsonb_build_object(
    'event', v_ev,
    'registration', v_rg,
    'tickets', coalesce((select jsonb_agg(to_jsonb(t) - 'id' - 'event_id' - 'created_at' order by t.display_order, t.key)
                           from public.gl_ticket t where t.event_id = src.id), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(to_jsonb(q) - 'id' - 'event_id' - 'created_at' order by q.display_order, q.key)
                             from public.gl_question q where q.event_id = src.id), '[]'::jsonb)));
end
$function$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 14b. Guards on the legacy catalogue tables. Both look for a core_v2 gl_event
--      on the row's event: none exists today, so they change nothing for the
--      old live client. SECURITY DEFINER: gl_event is staff-only under RLS.
-- ═════════════════════════════════════════════════════════════════════════════
-- A core_v2 event registers in gl_guest only. A legacy event_registrations row
-- on it would give its holder the join link through the legacy branch of
-- get_my_event_access and skip M3 review and capacity. Covers the RLS path
-- (event_reg_insert) and the service-role guest-webinar-register alike.
create or replace function public.event_registrations_engine_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (select 1 from public.gl_event g where g.legacy_event_id = new.event_id and g.engine = 'core_v2') then
    raise exception using errcode = '23514',
      message = 'event_registrations_engine_guard: this event takes registrations through the registration function only';
  end if;
  return new;
end
$function$;

drop trigger if exists event_registrations_engine_guard on public.event_registrations;
create trigger event_registrations_engine_guard
  before insert or update of event_id on public.event_registrations
  for each row execute function public.event_registrations_engine_guard();

-- A core_v2 event becomes published only while its registration flag is on
-- (webinar_v2 for webinars, onsite_v2 for on-site events): until then the old
-- main site is live, and its event page sends every visitor of an event that
-- has a gl_event slug (gl_event_slug_for is engine-blind) to /{slug}, which
-- main does not have. Covers direct writes (the events admin list); new events
-- are checked by admin_save_event itself (their gl_event row comes after).
create or replace function public.events_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_kind text;
  v_flag text;
begin
  if tg_op = 'UPDATE' and old.published is true then
    return new;
  end if;
  select g.kind into v_kind from public.gl_event g where g.legacy_event_id = new.id and g.engine = 'core_v2';
  if v_kind is null then
    return new;
  end if;
  v_flag := case when v_kind = 'webinar' then 'webinar_v2' else 'onsite_v2' end;
  if not coalesce((select (ps.value ->> v_flag) = 'true' from public.platform_settings ps where ps.key = 'registration_flags'), false) then
    raise exception using errcode = '22023', message = 'publish_needs_flag',
      detail = format('Publishing waits for the new registration pages (flag %s).', v_flag);
  end if;
  return new;
end
$function$;

drop trigger if exists events_publish_guard on public.events;
create trigger events_publish_guard
  before insert or update of published on public.events
  for each row
  when (new.published is true)
  execute function public.events_publish_guard();

-- ═════════════════════════════════════════════════════════════════════════════
-- 15. pg_cron: registration-cron (Vault service key, as invoke_send_profile_reminders)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.invoke_registration_cron(p_job text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_url text;
  v_key text;
  v_flags jsonb;
  v_go boolean;
begin
  if p_job is null or p_job not in ('provision', 'reminders', 'digest') then
    return 'unknown job';
  end if;

  -- Dormant until the flag is on (and, for provisioning, until there is work):
  -- nothing is called before the registration-cron function is deployed.
  select ps.value into v_flags from public.platform_settings ps where ps.key = 'registration_flags';
  v_flags := coalesce(v_flags, '{}'::jsonb);
  v_go := case p_job
    when 'provision' then
      coalesce((v_flags ->> 'provisioning')::boolean, false)
      and exists (select 1 from public.account_provision_job j
                   where j.status = 'queued'
                      or (j.status = 'failed' and j.attempts < 5)
                      -- an account e-mail due and not sent; provision-person sets
                      -- email_due_at = null when none is to be sent. Backstop: an
                      -- e-mail overdue by more than 7 days no longer wakes the
                      -- cron on its own (it is still sent on the next run).
                      or (j.status = 'done' and j.email_sent_at is null
                          and j.email_due_at <= now() and j.email_due_at > now() - interval '7 days'))
    when 'reminders' then
      coalesce((v_flags ->> 'webinar_v2')::boolean, false) or coalesce((v_flags ->> 'onsite_v2')::boolean, false)
    when 'digest' then
      coalesce((v_flags ->> 'review_queue')::boolean, false)
      and extract(hour from (now() at time zone 'Europe/Monaco')) = 8
  end;
  if not coalesce(v_go, false) then
    return 'skipped';
  end if;

  -- Same Vault secrets as invoke_send_profile_reminders(); exit quietly if missing.
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    raise notice 'invoke_registration_cron: vault read failed: %', sqlerrm;
    return 'no vault';
  end;
  if v_url is null or v_key is null then
    raise notice 'invoke_registration_cron: vault secrets not configured; skipping';
    return 'no vault';
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/registration-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('job', p_job),
    timeout_milliseconds := 60000
  );
  return 'called';
end
$function$;

-- cron.schedule with an existing name updates that job (pg_cron 1.6.4). GMT.
-- digest: 06:00 and 07:00 GMT; the invoker keeps the one that is 08:00 in Monaco.
select cron.schedule('registration-cron-provision', '*/5 * * * *',
  $cmd$select public.invoke_registration_cron('provision');$cmd$);
select cron.schedule('registration-cron-reminders', '10 * * * *',
  $cmd$select public.invoke_registration_cron('reminders');$cmd$);
select cron.schedule('registration-cron-digest', '0 6,7 * * *',
  $cmd$select public.invoke_registration_cron('digest');$cmd$);

-- ═════════════════════════════════════════════════════════════════════════════
-- 16. EXECUTE grants (Supabase grants new functions to anon and authenticated by
--     default: revoke, then grant what each caller needs)
-- ═════════════════════════════════════════════════════════════════════════════
-- internal / service role only
revoke all on function public.gl_try_ts(text) from public, anon, authenticated;
revoke all on function public.gl_event_window(uuid) from public, anon, authenticated;
revoke all on function public.gl_seats_held(uuid, text) from public, anon, authenticated;
revoke all on function public.gl_registration_state(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.gl_register_v2(jsonb) from public, anon, authenticated;
revoke all on function public.gl_decide_v2(uuid, uuid[], text, uuid, jsonb, boolean, boolean, text, text) from public, anon, authenticated;
revoke all on function public.gl_issue_access_token(uuid) from public, anon, authenticated;
revoke all on function public.gl_resolve_access_token(text, boolean) from public, anon, authenticated;
revoke all on function public.complete_signup_for(uuid) from public, anon, authenticated;
revoke all on function public.attach_my_records_for(uuid) from public, anon, authenticated;
revoke all on function public.on_email_proven(uuid) from public, anon, authenticated;
revoke all on function public.invoke_registration_cron(text) from public, anon, authenticated;
revoke all on function public.gl_guest_engine_guard() from public, anon, authenticated;
revoke all on function public.gl_guest_queue_provisioning() from public, anon, authenticated;
revoke all on function public.on_auth_email_confirmed() from public, anon, authenticated;
revoke all on function public.on_auth_email_changed() from public, anon, authenticated;
revoke all on function public.event_registrations_engine_guard() from public, anon, authenticated;
revoke all on function public.events_publish_guard() from public, anon, authenticated;
grant execute on function public.gl_try_ts(text) to service_role;
grant execute on function public.gl_event_window(uuid) to service_role;
grant execute on function public.gl_seats_held(uuid, text) to service_role;
grant execute on function public.gl_registration_state(uuid, uuid, text) to service_role;
grant execute on function public.gl_register_v2(jsonb) to service_role;
grant execute on function public.gl_decide_v2(uuid, uuid[], text, uuid, jsonb, boolean, boolean, text, text) to service_role;
grant execute on function public.gl_issue_access_token(uuid) to service_role;
grant execute on function public.gl_resolve_access_token(text, boolean) to service_role;
grant execute on function public.complete_signup_for(uuid) to service_role;
grant execute on function public.attach_my_records_for(uuid) to service_role;
grant execute on function public.on_email_proven(uuid) to service_role;
grant execute on function public.invoke_registration_cron(text) to service_role;

-- signed-in callers (each checks who the caller is)
revoke all on function public.attach_my_records() from public, anon;
revoke all on function public.mark_email_proven() from public, anon;
revoke all on function public.my_participations() from public, anon;
revoke all on function public.get_my_event_access(uuid[]) from public, anon;
revoke all on function public.gl_checkin_v2(uuid, uuid, uuid, boolean) from public, anon;
revoke all on function public.admin_save_event(jsonb) from public, anon;
revoke all on function public.admin_clone_event(uuid, jsonb) from public, anon;
revoke all on function public.review_log_add(text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.attach_my_records() to authenticated, service_role;
grant execute on function public.mark_email_proven() to authenticated, service_role;
grant execute on function public.my_participations() to authenticated, service_role;
grant execute on function public.get_my_event_access(uuid[]) to authenticated, service_role;
grant execute on function public.gl_checkin_v2(uuid, uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_save_event(jsonb) to authenticated, service_role;
grant execute on function public.admin_clone_event(uuid, jsonb) to authenticated, service_role;
grant execute on function public.review_log_add(text, uuid, text, text, jsonb) to authenticated, service_role;

-- public
revoke all on function public.public_registration_events() from public;
grant execute on function public.public_registration_events() to anon, authenticated, service_role;

comment on function public.gl_register_v2(jsonb) is 'Service role. Atomic core_v2 registration: {ok, duplicate, reactivated, guest_id, status} or {ok:false, error|state}. See docs/registration-contract.md.';
comment on function public.gl_decide_v2(uuid, uuid[], text, uuid, jsonb, boolean, boolean, text, text) is 'Service role. Atomic staff decision on core_v2 registrations (approve / reject / waitlist / request_info): capacity under the event lock, statuses, provisioning job choices, review_log. See docs/registration-contract.md.';
comment on function public.my_participations() is 'Signed-in read model: every registration of the caller across gl_guest (both engines), legacy event_registrations and SM26 (read-only).';
comment on function public.mark_email_proven() is 'Stamps profiles.email_proven_at when the session was opened from an auth e-mail link, then attaches records. Called by /welcome, /reset-password, /verify-email.';
comment on function public.admin_save_event(jsonb) is 'Staff. Writes events + gl_event (+ gl_ticket, gl_question) in one transaction; core_v2 only.';
comment on function public.gl_checkin_v2(uuid, uuid, uuid, boolean) is 'Staff. gl_checkin for both engines: door_token separate -> checkin_token, shared -> token.';
