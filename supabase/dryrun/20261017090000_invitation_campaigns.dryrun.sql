-- DRY RUN of supabase/migrations/20261017090000_invitation_campaigns.sql. NOT A MIGRATION.
-- ONE query text, ONE execute_sql call, BEFORE that file is applied. Everything rolls back:
-- the last statement raises 'DRYRUN ...'. The result is in that error message.
-- A. snapshot; B. the migration, verbatim; C. helpers; D. cases as a visitor, a verified
-- member, moderator and admin, the service role and the owner, each in its own rolled-back
-- sub-transaction, on a throw-away guest-list event. No sm_* row is written. Locks
-- storage.objects, gl_event, gl_guest and profiles for a few seconds (quiet hour; gives up
-- after 5 s: on "lock timeout", run it again).
-- Expected: "48 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot (case S01 reads it again after the migration: must be identical)
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'gl_guest', (select md5(coalesce(string_agg(g::text, ',' order by g.id), '')) from public.gl_guest g)
  union all select 'gl_event', (select md5(coalesce(string_agg(e::text, ',' order by e.id), '')) from public.gl_event e)
  union all select 'gl_email_log', (select count(*) || '/' || coalesce(max(l.id), 0) from public.gl_email_log l)
  union all select 'sm', concat_ws('/', (select count(*) from public.sm_registration), (select count(*) from public.sm_attendee),
                                   (select count(*) from public.sm_badge), (select count(*) from public.sm_invitation))
  union all select 'policies', (select md5(string_agg(format('%s.%s.%s|%s|%s|%s|%s', pl.schemaname, pl.tablename, pl.policyname,
                                  pl.cmd, pl.roles, pl.qual, pl.with_check), ';' order by pl.schemaname, pl.tablename, pl.policyname))
                                  from pg_policies pl where pl.policyname not like 'invitation%')
  union all select 'acls', (select md5(string_agg(p.oid::regprocedure::text || '=' || coalesce(array_to_string(p.proacl, ','), ''), ';'
                              order by p.oid::regprocedure::text))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'invitation%')
  union all select 'pins', (select md5(string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname, md5(p.prosrc)))
                              from pg_proc p where p.pronamespace = 'public'::regnamespace
                               and p.proname in ('gl_checkin', 'gl_checkin_v2', 'gl_guest_engine_guard', 'gl_guest_queue_provisioning',
                                 'invoke_registration_cron', 'invoke_send_profile_reminders', 'invoke_guest_webinar_reminders',
                                 'handle_new_user', 'has_capability', 'capability_set', 'complete_signup_for', 'is_moderator', 'is_admin'))
  union all select 'triggers', (select md5(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ','
                                  order by t.tgrelid::regclass::text, t.tgname))
                                  from pg_trigger t where not t.tgisinternal and t.tgrelid::regclass::text not like 'invitation%')
  union all select 'tables', (select md5(string_agg(c.oid::regclass::text || ':' || c.relrowsecurity::text || ':'
                                || coalesce(array_to_string(c.relacl, ','), ''), ';' order by c.oid::regclass::text))
                                from pg_class c where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace)
                                 and c.relkind = 'r' and c.relname not like 'invitation%')
  union all select 'buckets', (select md5(string_agg(b::text, ',' order by b.id)) from storage.buckets b where b.id <> 'invitation-files')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();

-- B. The migration, verbatim ───────────────────────────────────────────────────
-- invitation_campaigns: step 1 (part 1 of 2) of the "Invitation campaigns" admin module.
-- NOT APPLIED. Apply with Victor's OK, after the dry runs supabase/dryrun/20261017090000_*
-- (this file, and its down). Then part 2: 20261017091000_invitation_guest_link.sql.
-- Down: supabase/migrations/down/20261017090000_invitation_campaigns.down.sql (part 2's
-- down first). Plan: "9 M3 Connect/Module invitations - etape 0 - plan.md" (16 Oct 2026).
--
-- ADDITIVE ONLY: 3 tables, 9 invitation_* functions, the private bucket "invitation-files"
-- and its 4 policies on storage.objects. Nothing existing is redefined (no gl_*, sm_*,
-- organization_invitations, gl_invite_v2 or ops_health-pinned object). New foreign keys
-- point AT gl_event, gl_guest and profiles (ON DELETE SET NULL for the last two).
--
-- ONE LIST (Victor, 16 Oct): a campaign guest becomes an "invited" gl_guest row of the
-- campaign's guest-list event when the invitation goes out (part 2): same token, QR, door
-- and /wys26/guest page. Statuses draft and ready belong to staff; the link, sent and the
-- answers to the module's functions and sender. Access: verified admins and moderators
-- (public.is_moderator()); the service role (the step 4 sender) is trusted.
-- invitation_log is append-only for everyone, owner included; only the down removes it.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.gl_event') is null or to_regclass('public.gl_guest') is null
     or to_regclass('public.profiles') is null or to_regprocedure('public.is_moderator()') is null then
    raise exception 'invitation_campaigns: the guest-list tables, profiles or is_moderator() are missing';
  end if;
  if to_regclass('public.invitation_campaign') is not null or to_regclass('public.invitation_recipient') is not null
     or to_regclass('public.invitation_log') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'invitation\_%') then
    raise exception 'invitation_campaigns: already applied (or a name is taken)';
  end if;
  -- A private invitation-files bucket kept by an earlier down (it held files) is reused.
  if exists (select 1 from storage.buckets b where b.id = 'invitation-files' and b.public) then
    raise exception 'invitation_campaigns: a PUBLIC bucket invitation-files exists';
  end if;
end
$pre$;

-- 1. Helpers
-- invitation_trim: strips what JavaScript's trim() strips (guest-list v6 clean()): spaces,
-- tabs, line breaks, no-break and other Unicode spaces, BOM. Text pasted from Excel reaches
-- gl_guest as v6 would write it.
create function public.invitation_trim(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $f$
  select regexp_replace(p_text,
    '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '', 'g')
$f$;

-- invitation_norm: name keys for duplicate checks. Lower case, accents folded, punctuation
-- dropped. A person's name also loses its leading titles (H.E., Dr, Mr, Eng., Sheikh...);
-- an organisation loses every space, so "ACME S.A." and "Acme SA" meet.
create function public.invitation_norm(p_text text, p_person boolean default false)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $f$
  select case when p_person then
      btrim(regexp_replace(regexp_replace(
        translate(lower(coalesce(p_text, '')),
          'àáâãäåāăąçćčďđèéêëēėęěìíîïīįıłñńňòóôõöøōőŕřśšşșțťùúûüūůűųýÿźżžðþß',
          'aaaaaaaaacccddeeeeeeeeiiiiiiilnnnoooooooorrssssttuuuuuuuuyyzzzdts'),
        '^\s*((h\.?\s*e|h\.?\s*h|s\.?\s*e|dr|mr|mrs|ms|miss|mme|mlle|m|eng|prof|capt|sheikh|sheikha|sir|dame)\.?\s+)+', ''),
        '[^a-z0-9]+', ' ', 'g'))
    else
      regexp_replace(
        translate(lower(coalesce(p_text, '')),
          'àáâãäåāăąçćčďđèéêëēėęěìíîïīįıłñńňòóôõöøōőŕřśšşșțťùúûüūůűųýÿźżžðþß',
          'aaaaaaaaacccddeeeeeeeeiiiiiiilnnnoooooooorrssssttuuuuuuuuyyzzzdts'),
        '[^a-z0-9]+', '', 'g')
    end
$f$;

-- 2. Tables
-- A campaign belongs to ONE guest-list event (gl_event; its events row is
-- gl_event.legacy_event_id). settings: event facts; texts: ticket, letter and e-mail
-- blocks with {{variables}}. Kept here, not in the public repo (signature, phone number).
create table public.invitation_campaign (
  id uuid primary key default gen_random_uuid(),
  gl_event_id uuid not null references public.gl_event(id),
  name text not null check (btrim(name) <> '' and length(name) <= 200),
  ticket_style text not null default 'white' check (ticket_style in ('white', 'navy')),
  rsvp_deadline date,
  letter_date date,
  -- Access written on every guest-list row of the campaign. One value per campaign, no
  -- per-guest override: the WYS 2026 ticket backgrounds print "Conference and Gala Dinner".
  conference boolean not null default true,
  gala boolean not null default true,
  sender_name text check (sender_name is null or length(sender_name) <= 120),
  sender_email text check (sender_email is null or sender_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  reply_to text check (reply_to is null or reply_to ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  texts jsonb not null default '{}'::jsonb check (jsonb_typeof(texts) = 'object'),
  archived_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_campaign_parts check (conference or gala)
);
create index invitation_campaign_event on public.invitation_campaign (gl_event_id);

-- One invited person of a campaign. Names are capped at gl_guest's own limits so linking
-- never truncates. name_key, org_key and profile_user_id are kept by the trigger below.
create table public.invitation_recipient (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.invitation_campaign(id) on delete cascade,
  sort_order integer,
  honorific text check (honorific is null or length(honorific) <= 40),
  first_name text check (first_name is null or length(first_name) <= 80),
  last_name text check (last_name is null or length(last_name) <= 80),
  name_on_ticket text not null check (btrim(name_on_ticket) <> '' and length(name_on_ticket) <= 160),
  name_on_letter text check (name_on_letter is null or length(name_on_letter) <= 200),
  greeting text check (greeting is null or length(greeting) <= 120),
  position text check (position is null or length(position) <= 160),
  organisation text check (organisation is null or length(organisation) <= 160),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')),
  phone text check (phone is null or length(phone) <= 40),
  country text check (country is null or length(country) <= 80),
  notes text check (notes is null or length(notes) <= 2000),
  needs_check boolean not null default false,
  -- An account with this (proven) e-mail, if one exists. Never creates one.
  profile_user_id uuid references public.profiles(user_id) on delete set null,
  gl_guest_id uuid references public.gl_guest(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'sent', 'accepted', 'declined', 'no_answer')),
  generated_at timestamptz,
  sent_at timestamptz,
  responded_at timestamptz,
  ticket_pdf_path text,
  letter_pdf_path text,
  sending_at timestamptz,
  send_error text,
  name_key text not null default '',
  org_key text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index invitation_recipient_campaign_email on public.invitation_recipient (campaign_id, lower(email)) where email is not null;
create index invitation_recipient_campaign_name on public.invitation_recipient (campaign_id, name_key, org_key);
create index invitation_recipient_email on public.invitation_recipient (lower(email)) where email is not null;
create index invitation_recipient_name on public.invitation_recipient (name_key) where name_key <> '';
-- One guest-list row answers ONE invitation, whatever the campaign.
create unique index invitation_recipient_guest on public.invitation_recipient (gl_guest_id) where gl_guest_id is not null;
create index invitation_recipient_profile on public.invitation_recipient (profile_user_id) where profile_user_id is not null;

-- The journal. No foreign key on purpose: it outlives a deleted campaign or guest.
-- Payloads carry ids and statuses, not names or addresses.
create table public.invitation_log (
  id bigint generated always as identity primary key,
  campaign_id uuid,
  recipient_id uuid,
  action text not null check (action ~ '^[a-z][a-z0-9_]{1,47}$'),
  actor_id uuid default auth.uid(),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 16000),
  at timestamptz not null default now()
);
create index invitation_log_campaign on public.invitation_log (campaign_id, at desc);
create index invitation_log_recipient on public.invitation_log (recipient_id, at desc) where recipient_id is not null;

comment on table public.invitation_campaign is 'Invitation campaigns module: one campaign = one guest-list event (gl_event), its settings and texts. Staff only.';
comment on table public.invitation_recipient is 'Invitation campaigns module: one invited person. Linked to the gl_guest row when the invitation goes out (invitation_link_guest). Staff only.';
comment on table public.invitation_log is 'Invitation campaigns module: append-only journal. Staff read and add; nobody updates or deletes.';

-- 3. Triggers
-- The journal's actor: the signed-in user, else the staff member the service role acts
-- for (set as invitation.actor by part 2's functions).

-- 3a. Tidy a guest row (definer: it reads auth.users for the e-mail proof).
create function public.invitation_recipient_normalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
begin
  new.email := nullif(lower(public.invitation_trim(new.email)), '');
  new.honorific := nullif(public.invitation_trim(new.honorific), '');
  new.first_name := nullif(public.invitation_trim(new.first_name), '');
  new.last_name := nullif(public.invitation_trim(new.last_name), '');
  new.name_on_ticket := public.invitation_trim(new.name_on_ticket);
  new.name_on_letter := nullif(public.invitation_trim(new.name_on_letter), '');
  new.greeting := nullif(public.invitation_trim(new.greeting), '');
  new.position := nullif(public.invitation_trim(new.position), '');
  new.organisation := nullif(public.invitation_trim(new.organisation), '');
  new.phone := nullif(public.invitation_trim(new.phone), '');
  new.country := nullif(public.invitation_trim(new.country), '');
  new.name_key := public.invitation_norm(
    case when coalesce(new.first_name, '') || coalesce(new.last_name, '') <> ''
         then concat_ws(' ', new.first_name, new.last_name) else new.name_on_ticket end, true);
  new.org_key := public.invitation_norm(new.organisation, false);
  if tg_op = 'INSERT' then
    -- The import flags "a verifier" / "à vérifier" / "to check" notes; staff clear it later.
    if new.notes ~* 'v.rifier|to (be )?check' then
      new.needs_check := true;
    end if;
  else
    new.updated_at := now();
  end if;
  -- Always recomputed (a value typed by hand never sticks): the account with this address,
  -- only when the address is proven (Confirm email is off: anyone can sign up with someone
  -- else's address). Information only: nothing is linked.
  new.profile_user_id := (
    select p.user_id from public.profiles p join auth.users u on u.id = p.user_id
     where new.email is not null and p.email_proven_at is not null
       and lower(p.email) = new.email and lower(u.email) = new.email
     order by p.user_id limit 1);
  return new;
end
$f$;

-- 3b. What staff may do by hand (API roles only; the module's functions, the service role
-- and a direct session are trusted). Invoker, so current_user is the caller's role.
create function public.invitation_recipient_guard()
returns trigger
language plpgsql
set search_path = ''
as $f$
begin
  if current_user not in ('anon', 'authenticated') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'ready') or new.gl_guest_id is not null
       or new.sent_at is not null or new.responded_at is not null then
      raise exception using errcode = '42501',
        message = 'invitation_recipient: a new guest starts as draft or ready, not linked, not sent';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.gl_guest_id is not null or old.status not in ('draft', 'ready') then
      raise exception using errcode = '42501',
        message = 'invitation_recipient: a guest who was invited (or is on the guest list) cannot be deleted';
    end if;
    return old;
  end if;
  if new.campaign_id is distinct from old.campaign_id then
    raise exception using errcode = '42501', message = 'invitation_recipient: a guest cannot move to another campaign';
  end if;
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'invitation_recipient: created_by and created_at cannot change';
  end if;
  if new.gl_guest_id is distinct from old.gl_guest_id then
    raise exception using errcode = '42501',
      message = 'invitation_recipient: the guest-list link is set by invitation_link_guest and undone by invitation_unlink_guest only';
  end if;
  if new.status is distinct from old.status
     and not (old.status in ('draft', 'ready') and new.status in ('draft', 'ready')) then
    raise exception using errcode = '42501',
      message = 'invitation_recipient: sent, accepted, declined and no answer are set by the send and answer actions';
  end if;
  if new.sent_at is distinct from old.sent_at or new.responded_at is distinct from old.responded_at then
    raise exception using errcode = '42501', message = 'invitation_recipient: sent_at and responded_at are set by the module';
  end if;
  if new.email is distinct from old.email and old.gl_guest_id is not null then
    raise exception using errcode = '42501',
      message = 'invitation_recipient: this guest is on the guest list; their e-mail cannot change here';
  end if;
  return new;
end
$f$;

-- 3c. Journal of every guest row change that matters (definer: writes the log).
create function public.invitation_recipient_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('invitation.actor', true), '')::uuid);
begin
  if tg_op = 'INSERT' then
    insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
    values (new.campaign_id, new.id, 'recipient_added', v_actor, jsonb_build_object('status', new.status));
  elsif tg_op = 'DELETE' then
    insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
    values (old.campaign_id, old.id, 'recipient_deleted', v_actor, jsonb_build_object('status', old.status, 'gl_guest_id', old.gl_guest_id));
  else
    if new.status is distinct from old.status then
      insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
      values (new.campaign_id, new.id, 'status_changed', v_actor, jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.gl_guest_id is distinct from old.gl_guest_id then
      insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
      values (new.campaign_id, new.id, 'guest_link_changed', v_actor, jsonb_build_object('from', old.gl_guest_id, 'to', new.gl_guest_id));
    end if;
    if new.email is distinct from old.email then
      insert into public.invitation_log (campaign_id, recipient_id, action, actor_id, payload)
      values (new.campaign_id, new.id, 'email_changed', v_actor,
              jsonb_build_object('had_email', old.email is not null, 'has_email', new.email is not null));
    end if;
  end if;
  return null;
end
$f$;

-- 3d. Campaign: updated_at; created_by and created_at kept; no deleting a campaign that
-- invited someone, no moving a campaign with guests to another event (API roles; invoker).
create function public.invitation_campaign_guard()
returns trigger
language plpgsql
set search_path = ''
as $f$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if current_user not in ('anon', 'authenticated') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.invitation_recipient r
                where r.campaign_id = old.id and (r.gl_guest_id is not null or r.status not in ('draft', 'ready'))) then
      raise exception using errcode = '42501',
        message = 'invitation_campaign: this campaign has invited guests; archive it instead of deleting it';
    end if;
    return old;
  end if;
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'invitation_campaign: created_by and created_at cannot change';
  end if;
  if new.gl_event_id is distinct from old.gl_event_id
     and exists (select 1 from public.invitation_recipient r where r.campaign_id = old.id) then
    raise exception using errcode = '42501', message = 'invitation_campaign: a campaign with guests cannot change event';
  end if;
  return new;
end
$f$;

create function public.invitation_campaign_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('invitation.actor', true), '')::uuid);
begin
  if tg_op = 'INSERT' then
    insert into public.invitation_log (campaign_id, action, actor_id, payload)
    values (new.id, 'campaign_created', v_actor, jsonb_build_object('gl_event_id', new.gl_event_id));
  elsif tg_op = 'DELETE' then
    insert into public.invitation_log (campaign_id, action, actor_id, payload)
    values (old.id, 'campaign_deleted', v_actor, jsonb_build_object('gl_event_id', old.gl_event_id));
  elsif new.archived_at is distinct from old.archived_at then
    insert into public.invitation_log (campaign_id, action, actor_id)
    values (new.id, case when new.archived_at is null then 'campaign_restored' else 'campaign_archived' end, v_actor);
  end if;
  return null;
end
$f$;

-- 3e. The journal is append-only, even for the service role and the owner.
create function public.invitation_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $f$
begin
  raise exception using errcode = '42501', message = 'invitation_log is append-only';
end
$f$;

create trigger invitation_recipient_a_normalize before insert or update on public.invitation_recipient
  for each row execute function public.invitation_recipient_normalize();
create trigger invitation_recipient_b_guard before insert or update or delete on public.invitation_recipient
  for each row execute function public.invitation_recipient_guard();
create trigger invitation_recipient_c_log after insert or update or delete on public.invitation_recipient
  for each row execute function public.invitation_recipient_log();
create trigger invitation_campaign_a_guard before insert or update or delete on public.invitation_campaign
  for each row execute function public.invitation_campaign_guard();
create trigger invitation_campaign_b_log after insert or update or delete on public.invitation_campaign
  for each row execute function public.invitation_campaign_log();
create trigger invitation_log_no_change before update or delete on public.invitation_log
  for each row execute function public.invitation_log_append_only();
create trigger invitation_log_no_truncate before truncate on public.invitation_log
  for each statement execute function public.invitation_log_append_only();

-- 4. Row level security: verified admins and moderators only
alter table public.invitation_campaign enable row level security;
alter table public.invitation_recipient enable row level security;
alter table public.invitation_log enable row level security;

create policy invitation_campaign_staff on public.invitation_campaign for all to authenticated
  using ((select public.is_moderator())) with check ((select public.is_moderator()));
create policy invitation_recipient_staff on public.invitation_recipient for all to authenticated
  using ((select public.is_moderator())) with check ((select public.is_moderator()));
create policy invitation_log_staff_read on public.invitation_log for select to authenticated
  using ((select public.is_moderator()));
create policy invitation_log_staff_add on public.invitation_log for insert to authenticated
  with check ((select public.is_moderator()) and actor_id is not distinct from (select auth.uid()));

-- Table rights: the project's default grants everything to anon, authenticated and
-- service_role. TRUNCATE would bypass RLS and the row triggers.
revoke all on table public.invitation_campaign, public.invitation_recipient, public.invitation_log from anon;
revoke truncate, references, trigger on table public.invitation_campaign, public.invitation_recipient
  from authenticated, service_role;
revoke update, delete, truncate, references, trigger on table public.invitation_log from authenticated, service_role;

-- 5. Duplicates: same e-mail or same name, across the event's campaigns and guest list.
-- Staff decide; nothing is merged. match_on: email, name_org or name.
create function public.invitation_find_duplicates(p_campaign_id uuid, p_recipient_id uuid default null)
returns table (recipient_id uuid, match_on text, other_kind text, other_id uuid, other_campaign_id uuid,
               other_label text, other_status text)
language plpgsql
stable
security definer
set search_path = ''
as $f$
#variable_conflict use_column
declare
  v_event uuid;
begin
  if not (coalesce(public.is_moderator(), false) or coalesce(auth.role(), '') = 'service_role') then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  select c.gl_event_id into v_event from public.invitation_campaign c where c.id = p_campaign_id;
  if v_event is null then
    raise exception using errcode = '22023', message = 'campaign_not_found';
  end if;
  return query
    with mine as (
      select r.id, r.email, r.name_key, r.org_key, r.gl_guest_id
        from public.invitation_recipient r
       where r.campaign_id = p_campaign_id and (p_recipient_id is null or r.id = p_recipient_id)
    )
    select m.id,
           case when m.email is not null and o.email = m.email then 'email'
                when m.org_key <> '' and o.org_key = m.org_key then 'name_org'
                else 'name' end,
           'recipient'::text, o.id, o.campaign_id,
           coalesce(nullif(concat_ws(' ', o.first_name, o.last_name), ''), o.name_on_ticket),
           o.status
      from mine m
      join public.invitation_recipient o on o.id <> m.id
      join public.invitation_campaign oc on oc.id = o.campaign_id and oc.gl_event_id = v_event
     where (m.email is not null and o.email = m.email)
        or (m.name_key <> '' and o.name_key = m.name_key)
    union all
    select m.id,
           case when m.email is not null and lower(g.email) = m.email then 'email'
                when m.org_key <> '' and public.invitation_norm(g.company, false) = m.org_key then 'name_org'
                else 'name' end,
           'guest'::text, g.id, null::uuid,
           btrim(concat_ws(' ', g.first_name, g.last_name)),
           g.status
      from mine m
      join public.gl_guest g on g.event_id = v_event and g.id is distinct from m.gl_guest_id
     where not exists (select 1 from public.invitation_recipient x where x.gl_guest_id = g.id)
       and ((m.email is not null and lower(g.email) = m.email)
         or (m.name_key <> '' and public.invitation_norm(g.first_name || ' ' || g.last_name, true) = m.name_key))
     order by 1, 3, 4;
end
$f$;

-- 6. Function privileges
revoke all on function public.invitation_norm(text, boolean) from public, anon;
revoke all on function public.invitation_trim(text) from public, anon;
revoke all on function public.invitation_find_duplicates(uuid, uuid) from public, anon;
grant execute on function public.invitation_norm(text, boolean) to authenticated, service_role;
grant execute on function public.invitation_trim(text) to authenticated, service_role;
grant execute on function public.invitation_find_duplicates(uuid, uuid) to authenticated, service_role;
-- Trigger functions are never called directly.
revoke all on function public.invitation_recipient_normalize() from public, anon, authenticated;
revoke all on function public.invitation_recipient_guard() from public, anon, authenticated;
revoke all on function public.invitation_recipient_log() from public, anon, authenticated;
revoke all on function public.invitation_campaign_guard() from public, anon, authenticated;
revoke all on function public.invitation_campaign_log() from public, anon, authenticated;
revoke all on function public.invitation_log_append_only() from public, anon, authenticated;

-- 7. Private storage: <campaign id>/<recipient id>/ticket.pdf and letter.pdf, and
-- letterhead/signature.png (the SM26 letters' signature, uploaded once by hand). Staff
-- read them through signed URLs. NOT event-media: SM26 partners read part of it. A
-- private bucket kept by an earlier down is reused, files included. The policies lock
-- storage.objects until commit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invitation-files', 'invitation-files', false, 26214400,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy invitation_files_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'invitation-files' and (select public.is_moderator()));
create policy invitation_files_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invitation-files' and (select public.is_moderator()));
create policy invitation_files_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'invitation-files' and (select public.is_moderator()))
  with check (bucket_id = 'invitation-files' and (select public.is_moderator()));
create policy invitation_files_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'invitation-files' and (select public.is_moderator()));

-- C. Test helpers ──────────────────────────────────────────────────────────────
set local statement_timeout = '120s';

-- A verified user with a proven address (handle_new_user creates the profile).
create function pg_temp.dr_user(p_id uuid, p_email text, p_persona text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', '{}'::jsonb, now(), now(), now());
  update public.profiles
     set email_proven_at = now(), access_status = 'verified'::public.access_status_enum,
         persona = p_persona::public.persona_enum, onboarding_status = 'completed'::public.onboarding_status_enum
   where user_id = p_id;
end
$f$;

-- D. Cases ─────────────────────────────────────────────────────────────────────
do $dryrun$
declare
  tests jsonb := '[]'::jsonb;
  t jsonb;
  kv record;
  vars jsonb;
  s0 text;
  v_q text; v_setup text; v_chkq text; v_exp text;
  v_uid uuid; v_dml boolean; v_ret text; v_n bigint;
  v_err text; v_state text; v_chk boolean; v_pass boolean; v_serr text; v_oerr text;
  n_pass integer := 0; n_fail integer := 0;
  results text := '';
  r8 text := substr(md5(random()::text), 1, 8);
begin
  vars := jsonb_build_object('admin', gen_random_uuid(), 'moder', gen_random_uuid(), 'member', gen_random_uuid(),
    'ev', gen_random_uuid(), 'ev2', gen_random_uuid(), 'c1', gen_random_uuid(), 'c2', gen_random_uuid(),
    'r1', gen_random_uuid(), 'r2', gen_random_uuid(), 'r3', gen_random_uuid(), 'r4', gen_random_uuid(),
    'g_req', gen_random_uuid(),
    'e_admin', 'dryrun-admin-' || r8 || '@example.invalid', 'e_moder', 'dryrun-moder-' || r8 || '@example.invalid',
    'e_member', 'dryrun-member-' || r8 || '@example.invalid', 'e_r1', 'dryrun-leo-' || r8 || '@example.invalid',
    'e_req', 'dryrun-ines-' || r8 || '@example.invalid', 'e_new', 'Dryrun-New-' || r8 || '@Example.INVALID', 'r8', r8);
  -- Shared setup (as the owner): 3 users, a throw-away guest-list event with a pending public
  -- request, two campaigns on it. r1 and r4 share an address across campaigns; r1 and r3 share
  -- a name; r2 has the address of the pending request.
  s0 := $s$select pg_temp.dr_user({admin}, {e_admin}, 'admin');
select pg_temp.dr_user({moder}, {e_moder}, 'moderator');
select pg_temp.dr_user({member}, {e_member}, 'marina');
insert into public.gl_event (id, slug, title, capacity) values ({ev}, 'dryrun-inv-' || {r8}, 'Dryrun invitations', 3);
insert into public.gl_guest (id, event_id, source, status, first_name, last_name, email, company)
values ({g_req}, {ev}, 'request', 'requested', 'Ines', 'Dryrun', {e_req}, 'Acme SA');
insert into public.invitation_campaign (id, gl_event_id, name) values ({c1}, {ev}, 'Dryrun C1'), ({c2}, {ev}, 'Dryrun C2');
insert into public.invitation_recipient (id, campaign_id, first_name, last_name, name_on_ticket, email, organisation, status) values
  ({r1}, {c1}, 'Leo', 'Sample', 'Mr Leo Sample', {e_r1}, 'Sample & Co', 'ready'),
  ({r2}, {c1}, 'Ines', 'Dryrun', 'Dr Ines Dryrun', {e_req}, 'ACME S.A.', 'ready'),
  ({r3}, {c2}, 'Leo', 'Sample', 'Leo Sample', null, 'Sample and Co', 'draft'),
  ({r4}, {c2}, 'Lucky', 'Twin', 'Lucky Twin', upper({e_r1}), null, 'ready')$s$;

  tests := jsonb_build_array(
    -- Structure
    jsonb_build_object('id', 'S01', 'who', 'postgres', 'bare', true, 'expect', 'ret:0',
      'label', 'nothing else changed: guest list, SM26 counts, other policies, function ACLs, ops_health pins, triggers, tables, buckets',
      'q', $q$select count(*)::text from ((select * from _dr_before except select * from pg_temp.dr_snap())
               union all (select * from pg_temp.dr_snap() except select * from _dr_before)) d$q$),
    jsonb_build_object('id', 'S02', 'who', 'postgres', 'bare', true, 'expect', 'ret:true/false/false/false/true',
      'label', 'RLS on the 3 tables; visitors have no table rights; nobody may update or delete the journal; staff may add to it',
      'q', $q$select concat_ws('/', (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.invitation_campaign'::regclass,
                 'public.invitation_recipient'::regclass, 'public.invitation_log'::regclass))::text,
               has_table_privilege('anon', 'public.invitation_recipient', 'select')::text,
               has_table_privilege('authenticated', 'public.invitation_log', 'update')::text,
               has_table_privilege('service_role', 'public.invitation_log', 'delete')::text,
               has_table_privilege('authenticated', 'public.invitation_log', 'insert')::text)$q$),
    jsonb_build_object('id', 'S03', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/true/false/false',
      'label', 'EXECUTE: duplicates check not for visitors, for signed-in callers (it checks staff itself); trigger functions for nobody',
      'q', $q$select concat_ws('/', has_function_privilege('anon', 'public.invitation_find_duplicates(uuid,uuid)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_find_duplicates(uuid,uuid)', 'execute')::text,
               has_function_privilege('authenticated', 'public.invitation_recipient_normalize()', 'execute')::text,
               has_function_privilege('anon', 'public.invitation_norm(text,boolean)', 'execute')::text)$q$),
    jsonb_build_object('id', 'S04', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/26214400/4',
      'label', 'bucket invitation-files is private, 25 MB, 4 staff policies',
      'q', $q$select concat_ws('/', (select b.public::text || '/' || b.file_size_limit from storage.buckets b where b.id = 'invitation-files'),
               (select count(*) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
                 and p.policyname like 'invitation_files_staff_%'))$q$),
    jsonb_build_object('id', 'S05', 'who', 'postgres', 'bare', true, 'expect', 'ret:false/false/false/false/false',
      'label', 'no TRUNCATE (it skips RLS and the row triggers), REFERENCES or TRIGGER right for signed-in callers or the service role',
      'q', $q$select concat_ws('/', has_table_privilege('authenticated', 'public.invitation_recipient', 'truncate')::text,
               has_table_privilege('service_role', 'public.invitation_campaign', 'truncate')::text,
               has_table_privilege('service_role', 'public.invitation_log', 'truncate')::text,
               has_table_privilege('authenticated', 'public.invitation_campaign', 'references')::text,
               has_table_privilege('authenticated', 'public.invitation_log', 'trigger')::text)$q$),
    -- Who reads and writes
    jsonb_build_object('id', 'R01', 'who', 'anon', 'expect', 'rls', 'label', 'a visitor cannot read campaigns',
      'q', $q$select count(*)::text from public.invitation_campaign$q$),
    jsonb_build_object('id', 'R02', 'who', 'member', 'expect', 'ret:0', 'label', 'a verified member sees no campaign guest',
      'q', $q$select count(*)::text from public.invitation_recipient$q$),
    jsonb_build_object('id', 'R03', 'who', 'member', 'expect', 'rls', 'label', 'a verified member cannot create a campaign',
      'q', $q$insert into public.invitation_campaign (gl_event_id, name) values ({ev}, 'nope')$q$),
    jsonb_build_object('id', 'R04', 'who', 'moder', 'expect', 'ret:4', 'label', 'a verified moderator reads the guests',
      'q', $q$select count(*)::text from public.invitation_recipient r where r.campaign_id in ({c1}, {c2})$q$),
    jsonb_build_object('id', 'R05', 'who', 'member', 'expect', 'ret:0', 'label', 'a verified member reads no journal line',
      'q', $q$select count(*)::text from public.invitation_log l where l.campaign_id = {c1}$q$),
    -- Guest rows: tidy, flags, journal, hand rules
    jsonb_build_object('id', 'G01', 'who', 'admin', 'expect', 'allow',
      'label', 'an admin adds a guest: tab, no-break space, BOM trimmed as v6; address lowered; "a verifier" flagged; key without titles; in the admin''s name',
      'q', $q$insert into public.invitation_recipient (campaign_id, first_name, last_name, name_on_ticket, email, notes, created_by)
               values ({c1}, E'\t Amir\u00a0', 'Placeholder', E'\ufeffH.E. Dr Amir Placeholder ', E'\u00a0 ' || {e_new} || E' \n',
                       'Titre a verifier', {member})$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r where r.campaign_id = {c1} and r.email = lower({e_new})
               and r.first_name = 'Amir' and r.name_on_ticket = 'H.E. Dr Amir Placeholder' and r.needs_check
               and r.name_key = 'amir placeholder' and r.status = 'draft' and r.created_by = {admin} and r.profile_user_id is null)
             and exists (select 1 from public.invitation_log l join public.invitation_recipient r on r.id = l.recipient_id
               where r.email = lower({e_new}) and l.action = 'recipient_added' and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'G02', 'who', 'admin', 'expect', 'err:invitation_recipient_campaign_email',
      'label', 'the same address twice in one campaign is refused, whatever the case',
      'q', $q$insert into public.invitation_recipient (campaign_id, name_on_ticket, email) values ({c1}, 'Dup', upper({e_r1}))$q$),
    jsonb_build_object('id', 'G03', 'who', 'admin', 'expect', 'err:starts as draft or ready',
      'label', 'a guest cannot be created as sent',
      'q', $q$insert into public.invitation_recipient (campaign_id, name_on_ticket, status) values ({c1}, 'Sent', 'sent')$q$),
    jsonb_build_object('id', 'G04', 'who', 'admin', 'expect', 'err:set by the send and answer actions',
      'label', 'accepted cannot be typed in by hand',
      'q', $q$update public.invitation_recipient set status = 'accepted' where id = {r1}$q$),
    jsonb_build_object('id', 'G05', 'who', 'admin', 'expect', 'allow', 'label', 'ready back to draft is fine, and journalled',
      'q', $q$update public.invitation_recipient set status = 'draft' where id = {r1}$q$,
      'chk', $c$select exists (select 1 from public.invitation_log l where l.recipient_id = {r1} and l.action = 'status_changed'
               and l.payload = '{"from": "ready", "to": "draft"}'::jsonb and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'G06', 'who', 'admin', 'expect', 'err:set by invitation_link_guest',
      'label', 'the guest-list link cannot be set by hand',
      'q', $q$update public.invitation_recipient set gl_guest_id = {g_req} where id = {r2}$q$),
    jsonb_build_object('id', 'G07', 'who', 'admin', 'expect', 'err:cannot be deleted',
      'label', 'a guest on the guest list cannot be deleted, even while still ready (not sent)',
      'setup', $s$update public.invitation_recipient set gl_guest_id = {g_req} where id = {r2}$s$,
      'q', $q$delete from public.invitation_recipient where id = {r2}$q$),
    jsonb_build_object('id', 'G08', 'who', 'admin', 'expect', 'err:cannot change here',
      'label', 'nor can their address change',
      'setup', $s$update public.invitation_recipient set gl_guest_id = {g_req} where id = {r2}$s$,
      'q', $q$update public.invitation_recipient set email = 'other-' || {r8} || '@example.invalid' where id = {r2}$q$),
    jsonb_build_object('id', 'G09', 'who', 'admin', 'expect', 'allow',
      'label', 'their name on the ticket can still be corrected (key kept from first and last name)',
      'setup', $s$update public.invitation_recipient set gl_guest_id = {g_req}, status = 'sent' where id = {r2}$s$,
      'q', $q$update public.invitation_recipient set name_on_ticket = 'Dr Ines Dryrun-Smith' where id = {r2}$q$,
      'chk', $c$select (select r.name_key from public.invitation_recipient r where r.id = {r2}) = 'ines dryrun'$c$),
    jsonb_build_object('id', 'G10', 'who', 'admin', 'expect', 'allow', 'label', 'a draft guest can be deleted, and it is journalled',
      'q', $q$delete from public.invitation_recipient where id = {r3}$q$,
      'chk', $c$select exists (select 1 from public.invitation_log l where l.recipient_id = {r3} and l.action = 'recipient_deleted'
               and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'G11', 'who', 'admin', 'expect', 'allow', 'label', 'the account with a proven address is spotted (no account made)',
      'q', $q$insert into public.invitation_recipient (campaign_id, name_on_ticket, email) values ({c1}, 'A Member', {e_member})$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r where r.campaign_id = {c1} and r.email = {e_member}
               and r.profile_user_id = {member})$c$),
    jsonb_build_object('id', 'G12', 'who', 'admin', 'expect', 'allow', 'label', 'an unproven address is not matched to the account',
      'setup', $s$update public.profiles set email_proven_at = null where user_id = {member}$s$,
      'q', $q$insert into public.invitation_recipient (campaign_id, name_on_ticket, email) values ({c1}, 'A Member', {e_member})$q$,
      'chk', $c$select exists (select 1 from public.invitation_recipient r where r.campaign_id = {c1} and r.email = {e_member}
               and r.profile_user_id is null)$c$),
    jsonb_build_object('id', 'G13', 'who', 'moder', 'expect', 'rls', 'label', 'a guest cannot move to another campaign',
      'q', $q$update public.invitation_recipient set campaign_id = {c2} where id = {r1}$q$),
    jsonb_build_object('id', 'G14', 'who', 'admin', 'expect', 'err:set by invitation_link_guest',
      'label', 'the link cannot be cleared by hand either, even while ready (it would leave a live invited row behind)',
      'setup', $s$update public.invitation_recipient set gl_guest_id = {g_req} where id = {r2}$s$,
      'q', $q$update public.invitation_recipient set gl_guest_id = null where id = {r2}$q$,
      'chk', $c$select (select r.gl_guest_id from public.invitation_recipient r where r.id = {r2}) = {g_req}$c$),
    jsonb_build_object('id', 'G15', 'who', 'moder', 'expect', 'allow',
      'label', 'an account typed in by hand never sticks: it is recomputed from the proven address',
      'q', $q$update public.invitation_recipient set profile_user_id = {member} where id = {r1}$q$,
      'chk', $c$select (select r.profile_user_id from public.invitation_recipient r where r.id = {r1}) is null$c$),
    jsonb_build_object('id', 'G16', 'who', 'admin', 'expect', 'err:created_by and created_at cannot change',
      'label', 'who created a guest cannot be rewritten',
      'q', $q$update public.invitation_recipient set created_by = {member} where id = {r1}$q$),
    -- Campaigns
    jsonb_build_object('id', 'C01', 'who', 'admin', 'expect', 'err:archive it instead',
      'label', 'a campaign with an invited guest cannot be deleted',
      'setup', $s$update public.invitation_recipient set gl_guest_id = {g_req}, status = 'sent' where id = {r2}$s$,
      'q', $q$delete from public.invitation_campaign where id = {c1}$q$),
    jsonb_build_object('id', 'C02', 'who', 'admin', 'expect', 'allow',
      'label', 'a campaign of drafts can be deleted with its guests, journalled',
      'q', $q$delete from public.invitation_campaign where id = {c2}$q$,
      'chk', $c$select not exists (select 1 from public.invitation_recipient r where r.campaign_id = {c2})
             and exists (select 1 from public.invitation_log l where l.campaign_id = {c2} and l.action = 'campaign_deleted')
             and exists (select 1 from public.invitation_log l where l.recipient_id = {r4} and l.action = 'recipient_deleted')$c$),
    jsonb_build_object('id', 'C03', 'who', 'admin', 'expect', 'err:cannot change event',
      'label', 'a campaign with guests cannot change event',
      'setup', $s$insert into public.gl_event (id, slug, title) values ({ev2}, 'dryrun-inv2-' || {r8}, 'Dryrun 2')$s$,
      'q', $q$update public.invitation_campaign set gl_event_id = {ev2} where id = {c1}$q$),
    jsonb_build_object('id', 'C04', 'who', 'moder', 'expect', 'allow', 'label', 'a moderator archives a campaign, journalled',
      'q', $q$update public.invitation_campaign set archived_at = now() where id = {c1}$q$,
      'chk', $c$select exists (select 1 from public.invitation_log l where l.campaign_id = {c1} and l.action = 'campaign_archived'
               and l.actor_id = {moder})$c$),
    jsonb_build_object('id', 'C05', 'who', 'moder', 'expect', 'allow', 'label', 'a campaign is created in its creator''s name, whatever is sent',
      'q', $q$insert into public.invitation_campaign (gl_event_id, name, created_by) values ({ev}, 'Dryrun C5', {member})$q$,
      'chk', $c$select (select c.created_by from public.invitation_campaign c where c.name = 'Dryrun C5') = {moder}$c$),
    -- The journal
    jsonb_build_object('id', 'L01', 'who', 'admin', 'expect', 'allow', 'label', 'staff add a journal line in their own name',
      'q', $q$insert into public.invitation_log (campaign_id, action, payload) values ({c1}, 'pdf_generated', '{"count": 2}')$q$,
      'chk', $c$select exists (select 1 from public.invitation_log l where l.campaign_id = {c1} and l.action = 'pdf_generated'
               and l.actor_id = {admin})$c$),
    jsonb_build_object('id', 'L02', 'who', 'admin', 'expect', 'rls', 'label', 'not in somebody else''s name',
      'q', $q$insert into public.invitation_log (campaign_id, action, actor_id) values ({c1}, 'forged', {member})$q$),
    jsonb_build_object('id', 'L03', 'who', 'admin', 'expect', 'rls', 'label', 'staff cannot edit the journal',
      'q', $q$update public.invitation_log set action = 'edited' where campaign_id = {c1}$q$),
    jsonb_build_object('id', 'L04', 'who', 'service', 'expect', 'rls', 'label', 'nor can the service role delete from it',
      'q', $q$delete from public.invitation_log where campaign_id = {c1}$q$),
    jsonb_build_object('id', 'L05', 'who', 'postgres', 'expect', 'err:append-only', 'label', 'nor can the owner',
      'q', $q$delete from public.invitation_log where campaign_id = {c1}$q$),
    -- Duplicates
    jsonb_build_object('id', 'D01', 'who', 'member', 'expect', 'rls', 'label', 'a member cannot run the duplicate check',
      'q', $q$select count(*)::text from public.invitation_find_duplicates({c1})$q$),
    jsonb_build_object('id', 'D02', 'who', 'admin', 'expect', 'ret:email:guest,email:recipient,name:recipient',
      'label', 'same address in another campaign, same name in another campaign, address of a pending request',
      'q', $q$select string_agg(d.match_on || ':' || d.other_kind, ',' order by d.match_on, d.other_kind)
               from public.invitation_find_duplicates({c1}) d$q$),
    jsonb_build_object('id', 'D03', 'who', 'service', 'expect', 'ret:none',
      'label', 'a guest-list row already linked to the guest is not reported (service role may call)',
      'setup', $s$update public.invitation_recipient set gl_guest_id = {g_req}, status = 'sent' where id = {r2}$s$,
      'q', $q$select coalesce(string_agg(d.match_on, ','), 'none') from public.invitation_find_duplicates({c1}, {r2}) d$q$),
    -- Private storage
    jsonb_build_object('id', 'F01', 'who', 'admin', 'expect', 'allow', 'label', 'an admin stores a PDF in invitation-files',
      'q', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
               values ('invitation-files', 'dryrun-' || {r8} || '/ticket.pdf', {admin}, {admin}, '{"size": 1000, "mimetype": "application/pdf"}')$q$),
    jsonb_build_object('id', 'F02', 'who', 'member', 'expect', 'rls', 'label', 'a member cannot',
      'q', $q$insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
               values ('invitation-files', 'dryrun-' || {r8} || '/x.pdf', {member}, {member}, '{"size": 1000, "mimetype": "application/pdf"}')$q$),
    jsonb_build_object('id', 'F03', 'who', 'member', 'expect', 'ret:0', 'label', 'nor read the files',
      'setup', $s$insert into storage.objects (bucket_id, name, metadata) values ('invitation-files', 'letterhead/dryrun-' || {r8} || '.png', '{"size": 10}')$s$,
      'q', $q$select count(*)::text from storage.objects o where o.bucket_id = 'invitation-files'$q$),
    jsonb_build_object('id', 'F04', 'who', 'anon', 'expect', 'ret:0', 'label', 'nor a visitor',
      'setup', $s$insert into storage.objects (bucket_id, name, metadata) values ('invitation-files', 'letterhead/dryrun-' || {r8} || '.png', '{"size": 10}')$s$,
      'q', $q$select count(*)::text from storage.objects o where o.bucket_id = 'invitation-files'$q$),
    jsonb_build_object('id', 'F05', 'who', 'moder', 'expect', 'ret:1', 'label', 'a moderator reads it (signed URLs)',
      'setup', $s$insert into storage.objects (bucket_id, name, metadata) values ('invitation-files', 'letterhead/dryrun-' || {r8} || '.png', '{"size": 10}')$s$,
      'q', $q$select count(*)::text from storage.objects o where o.bucket_id = 'invitation-files' and o.name = 'letterhead/dryrun-' || {r8} || '.png'$q$),
    -- F06-F09: direct deletes are allowed in the setup, so only RLS can stop them.
    jsonb_build_object('id', 'F06', 'who', 'member', 'expect', 'rls', 'label', 'a member cannot overwrite a file',
      'setup', $s$insert into storage.objects (bucket_id, name, metadata) values ('invitation-files', 'letterhead/dryrun-' || {r8} || '.png', '{"size": 10}')$s$,
      'q', $q$update storage.objects set metadata = '{"size": 1}' where bucket_id = 'invitation-files'$q$,
      'chk', $c$select (select o.metadata ->> 'size' from storage.objects o where o.bucket_id = 'invitation-files') = '10'$c$),
    jsonb_build_object('id', 'F07', 'who', 'anon', 'expect', 'rls', 'label', 'nor can a visitor',
      'setup', $s$insert into storage.objects (bucket_id, name, metadata) values ('invitation-files', 'letterhead/dryrun-' || {r8} || '.png', '{"size": 10}')$s$,
      'q', $q$update storage.objects set metadata = '{"size": 1}' where bucket_id = 'invitation-files'$q$,
      'chk', $c$select (select o.metadata ->> 'size' from storage.objects o where o.bucket_id = 'invitation-files') = '10'$c$),
    jsonb_build_object('id', 'F08', 'who', 'member', 'expect', 'rls', 'label', 'a member cannot delete a file',
      'setup', $s$insert into storage.objects (bucket_id, name, metadata) values ('invitation-files', 'letterhead/dryrun-' || {r8} || '.png', '{"size": 10}');
               select set_config('storage.allow_delete_query', 'true', true)$s$,
      'q', $q$delete from storage.objects where bucket_id = 'invitation-files'$q$,
      'chk', $c$select exists (select 1 from storage.objects o where o.bucket_id = 'invitation-files')$c$),
    jsonb_build_object('id', 'F09', 'who', 'anon', 'expect', 'rls', 'label', 'nor can a visitor',
      'setup', $s$insert into storage.objects (bucket_id, name, metadata) values ('invitation-files', 'letterhead/dryrun-' || {r8} || '.png', '{"size": 10}');
               select set_config('storage.allow_delete_query', 'true', true)$s$,
      'q', $q$delete from storage.objects where bucket_id = 'invitation-files'$q$,
      'chk', $c$select exists (select 1 from storage.objects o where o.bucket_id = 'invitation-files')$c$)
  );

  -- Runner: setup s0 + setup (owner), q as the caller, chk (owner), all rolled back. An
  -- expected error is caught around q only, so chk still runs. An error in setup, or any
  -- other error outside q, FAILS the case. {x} = quoted vars.x; <x> = raw.
  for t in select * from jsonb_array_elements(tests) loop
    v_q := t ->> 'q'; v_setup := coalesce(t ->> 'setup', ''); v_chkq := coalesce(t ->> 'chk', ''); v_exp := t ->> 'expect';
    if not coalesce((t ->> 'bare')::boolean, false) then v_setup := s0 || ';' || v_setup; end if;
    for kv in select * from jsonb_each_text(vars) loop
      v_q := replace(v_q, '{' || kv.key || '}', quote_literal(kv.value));
      v_setup := replace(v_setup, '{' || kv.key || '}', quote_literal(kv.value));
      v_chkq := replace(v_chkq, '{' || kv.key || '}', quote_literal(kv.value));
      v_exp := replace(v_exp, '<' || kv.key || '>', kv.value);
    end loop;
    v_dml := lower(left(ltrim(v_q), 6)) in ('insert', 'update', 'delete');
    v_ret := null; v_n := null; v_err := null; v_state := null; v_chk := null; v_serr := null; v_oerr := null;
    begin
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claim.role', '', true);
      begin
        if btrim(v_setup, ' ;') <> '' then execute v_setup; end if;
      exception when others then
        v_serr := sqlstate || ' ' || sqlerrm;
        raise exception using errcode = 'DRY02', message = 'setup failed';
      end;
      perform set_config('request.jwt.claims', '', true);
      if t ->> 'who' = 'postgres' then
        null;
      elsif t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', '{"role": "anon"}', true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
        set local role service_role;
      else
        v_uid := (vars ->> (t ->> 'who'))::uuid;
        perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated',
          'email', (select u.email from auth.users u where u.id = v_uid))::text, true);
        set local role authenticated;
      end if;
      begin
        if v_dml then
          execute v_q;
          get diagnostics v_n = row_count;
        else
          execute v_q into v_ret;
        end if;
      exception when others then
        if v_exp like 'err:%' or v_exp = 'rls' then v_err := sqlerrm; v_state := sqlstate; else raise; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if v_chkq <> '' then execute v_chkq into v_chk; end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' or sqlstate 'DRY02' then null;
      when others then v_oerr := sqlstate || ' ' || sqlerrm;
    end;
    v_pass := v_serr is null and v_oerr is null
              and coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'rls' then v_state = '42501' or (v_err is null and v_dml and v_n = 0)
                when v_exp like 'err:%' then strpos(v_err, substr(v_exp, 5)) > 0
                when v_exp like 'ret:%' then v_err is null and v_ret is not distinct from substr(v_exp, 5)
              end, false)
              and (v_chkq = '' or v_chk is true);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s: %s | expect %s | %s%s',
      case when v_pass then 'PASS' else 'FAIL' end, t ->> 'id', t ->> 'who', t ->> 'label', v_exp,
      left(case when v_serr is not null then 'SETUP ERROR ' || v_serr
                when v_oerr is not null then 'ERROR ' || v_oerr
                when v_err is not null then format('error %s: %s', v_state, v_err)
                when v_dml then v_n || ' row(s) written'
                else 'returned ' || coalesce(v_ret, 'null') end, 300),
      case when v_chkq <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (invitation_campaigns dry run, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
