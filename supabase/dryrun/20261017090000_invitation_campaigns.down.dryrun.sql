-- DRY RUN of supabase/migrations/down/20261017090000_invitation_campaigns.down.sql, and of
-- re-applying the migration after a down that kept the bucket. NOT A MIGRATION.
-- Run it BEFORE 20261017090000_invitation_campaigns is applied, like that file's own dry
-- run. ONE query text, ONE execute_sql call. Everything rolls back: the last statement
-- raises 'DRYRUN ...'; the result is in that error message.
-- Order: snapshot; the state an earlier down leaves when files remained (a private bucket
-- invitation-files with one file, no policy); the migration, verbatim (it must reuse that
-- bucket); a campaign, a guest and a file uploaded by a moderator; the down, verbatim (the
-- bucket holds files: kept); what a visitor, a member and a moderator still see in it; the
-- bucket emptied as from the dashboard; the down again, verbatim (the bucket goes); checks.
-- Locks as the migration's own dry run (storage.objects, gl_event, gl_guest, profiles).
-- Expected: "6 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot (compared at the end; gl_event aside: the run adds a test event)
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

-- B. What an earlier down leaves when the bucket held files ─────────────────────
create temp table _dr_ids on commit drop as
  select gen_random_uuid() as admin, gen_random_uuid() as moder, gen_random_uuid() as member, gen_random_uuid() as ev,
         gen_random_uuid() as c1, substr(md5(random()::text), 1, 8) as r8;
insert into storage.buckets (id, name, public, file_size_limit) values ('invitation-files', 'invitation-files', false, 1000);
insert into storage.objects (bucket_id, name, metadata)
  select 'invitation-files', 'letterhead/dryrun-old-' || i.r8 || '.png', '{"size": 10}' from _dr_ids i;

-- C. The migration, verbatim ───────────────────────────────────────────────────
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

create temp table _dr_up on commit drop as
  select b.public, b.file_size_limit, b.allowed_mime_types,
         (select count(*) from storage.objects o where o.bucket_id = 'invitation-files') as files
    from storage.buckets b where b.id = 'invitation-files';

-- D. Some data: users, a campaign with a guest, a file uploaded by the moderator ──
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
set local statement_timeout = '120s';
select pg_temp.dr_user(i.moder, 'dryrun-moder-' || i.r8 || '@example.invalid', 'moderator'),
       pg_temp.dr_user(i.member, 'dryrun-member-' || i.r8 || '@example.invalid', 'marina') from _dr_ids i;
insert into public.gl_event (id, slug, title, capacity) select i.ev, 'dryrun-down-' || i.r8, 'Dryrun down', 3 from _dr_ids i;
insert into public.invitation_campaign (id, gl_event_id, name) select i.c1, i.ev, 'Dryrun down' from _dr_ids i;
insert into public.invitation_recipient (campaign_id, first_name, last_name, name_on_ticket, email, status)
  select i.c1, 'Down', 'Test', 'Down Test', 'dryrun-down-' || i.r8 || '@example.invalid', 'ready' from _dr_ids i;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  select 'invitation-files', 'dryrun-' || i.r8 || '/ticket.pdf', i.moder, i.moder::text, '{"size": 1000}' from _dr_ids i;

-- E. The down, verbatim ────────────────────────────────────────────────────────
-- DOWN for supabase/migrations/20261017090000_invitation_campaigns.sql
-- Removes part 1 of the Invitation campaigns module: the 3 tables (with the campaigns,
-- their guests and the journal), its 9 functions, the 4 storage policies and the bucket
-- "invitation-files" when it is empty. Run part 2's down first (20261017091000; this file
-- also drops part 2's four functions if they are still there, so nothing is left dangling).
-- Dry run: supabase/dryrun/20261017090000_invitation_campaigns.down.dryrun.sql.
--
-- DATA: campaigns, campaign guests and the journal are DELETED with their tables (export
-- them first if they matter). The guest-list rows the module created or adopted (gl_guest)
-- STAY: they are the event's guest list, with their tokens and QR codes already e-mailed;
-- staff manage them in "WYS 2026" as before.
-- Files: Supabase refuses direct deletes from storage tables, so a bucket that still holds
-- files (generated PDFs, letterhead/signature.png) is KEPT, private and with no policy left:
-- nobody but the service role can read it. Applying the migration again reuses it. To drop
-- it, empty it from the dashboard and run this file again. The SM26 letters lose their
-- default signature until the module is back.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists invitation_files_staff_select on storage.objects;
drop policy if exists invitation_files_staff_insert on storage.objects;
drop policy if exists invitation_files_staff_update on storage.objects;
drop policy if exists invitation_files_staff_delete on storage.objects;

do $down$
begin
  if exists (select 1 from storage.buckets where id = 'invitation-files')
     and not exists (select 1 from storage.objects where bucket_id = 'invitation-files') then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'invitation-files';
    perform set_config('storage.allow_delete_query', 'false', true);
  else
    raise notice 'invitation_campaigns down: bucket invitation-files kept (it holds files, or is already gone)';
  end if;
end
$down$;

-- Part 2's functions and the duplicate check first, then the tables (their triggers and
-- policies go with them; DROP TABLE fires no row trigger, so the journal's append-only
-- guard does not stop it), then the trigger functions and the helpers.
drop function if exists public.invitation_set_answer(uuid, text, boolean, uuid);
drop function if exists public.invitation_unlink_guest(uuid, uuid);
drop function if exists public.invitation_link_guest(uuid, boolean, boolean, uuid);
drop function if exists public.invitation_actor(uuid);
drop function if exists public.invitation_find_duplicates(uuid, uuid);
drop table if exists public.invitation_log;
drop table if exists public.invitation_recipient;
drop table if exists public.invitation_campaign;
drop function if exists public.invitation_log_append_only();
drop function if exists public.invitation_campaign_log();
drop function if exists public.invitation_campaign_guard();
drop function if exists public.invitation_recipient_log();
drop function if exists public.invitation_recipient_guard();
drop function if exists public.invitation_recipient_normalize();
drop function if exists public.invitation_trim(text);
drop function if exists public.invitation_norm(text, boolean);

-- F. What each role still sees in the kept bucket ──────────────────────────────
create temp table _dr_kept on commit drop as
  select (select count(*) from storage.objects o where o.bucket_id = 'invitation-files') as files,
         (select b.public from storage.buckets b where b.id = 'invitation-files') as public,
         (select count(*) from pg_policies p where p.schemaname = 'storage' and p.policyname like 'invitation_files_%') as policies;
create temp table _dr_seen (who text, n bigint) on commit drop;
do $roles$
declare
  v_who text;
  v_uid uuid;
  v_n bigint;
begin
  foreach v_who in array array['anon', 'member', 'moder'] loop
    select case v_who when 'member' then i.member when 'moder' then i.moder end into v_uid from _dr_ids i;
    if v_who = 'anon' then
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    select count(*) into v_n from storage.objects o where o.bucket_id = 'invitation-files';
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into _dr_seen values (v_who, v_n);
  end loop;
end
$roles$;

-- G. The bucket emptied (as from the dashboard), then the down again, verbatim ──
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'invitation-files';
select set_config('storage.allow_delete_query', 'false', true);

-- DOWN for supabase/migrations/20261017090000_invitation_campaigns.sql
-- Removes part 1 of the Invitation campaigns module: the 3 tables (with the campaigns,
-- their guests and the journal), its 9 functions, the 4 storage policies and the bucket
-- "invitation-files" when it is empty. Run part 2's down first (20261017091000; this file
-- also drops part 2's four functions if they are still there, so nothing is left dangling).
-- Dry run: supabase/dryrun/20261017090000_invitation_campaigns.down.dryrun.sql.
--
-- DATA: campaigns, campaign guests and the journal are DELETED with their tables (export
-- them first if they matter). The guest-list rows the module created or adopted (gl_guest)
-- STAY: they are the event's guest list, with their tokens and QR codes already e-mailed;
-- staff manage them in "WYS 2026" as before.
-- Files: Supabase refuses direct deletes from storage tables, so a bucket that still holds
-- files (generated PDFs, letterhead/signature.png) is KEPT, private and with no policy left:
-- nobody but the service role can read it. Applying the migration again reuses it. To drop
-- it, empty it from the dashboard and run this file again. The SM26 letters lose their
-- default signature until the module is back.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists invitation_files_staff_select on storage.objects;
drop policy if exists invitation_files_staff_insert on storage.objects;
drop policy if exists invitation_files_staff_update on storage.objects;
drop policy if exists invitation_files_staff_delete on storage.objects;

do $down$
begin
  if exists (select 1 from storage.buckets where id = 'invitation-files')
     and not exists (select 1 from storage.objects where bucket_id = 'invitation-files') then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'invitation-files';
    perform set_config('storage.allow_delete_query', 'false', true);
  else
    raise notice 'invitation_campaigns down: bucket invitation-files kept (it holds files, or is already gone)';
  end if;
end
$down$;

-- Part 2's functions and the duplicate check first, then the tables (their triggers and
-- policies go with them; DROP TABLE fires no row trigger, so the journal's append-only
-- guard does not stop it), then the trigger functions and the helpers.
drop function if exists public.invitation_set_answer(uuid, text, boolean, uuid);
drop function if exists public.invitation_unlink_guest(uuid, uuid);
drop function if exists public.invitation_link_guest(uuid, boolean, boolean, uuid);
drop function if exists public.invitation_actor(uuid);
drop function if exists public.invitation_find_duplicates(uuid, uuid);
drop table if exists public.invitation_log;
drop table if exists public.invitation_recipient;
drop table if exists public.invitation_campaign;
drop function if exists public.invitation_log_append_only();
drop function if exists public.invitation_campaign_log();
drop function if exists public.invitation_campaign_guard();
drop function if exists public.invitation_recipient_log();
drop function if exists public.invitation_recipient_guard();
drop function if exists public.invitation_recipient_normalize();
drop function if exists public.invitation_trim(text);
drop function if exists public.invitation_norm(text, boolean);

-- H. Checks ────────────────────────────────────────────────────────────────────
do $check$
declare
  n_pass integer := 0; n_fail integer := 0; results text := '';
  v_ok boolean; v_label text;
begin
  for v_label, v_ok in
    select 'D1 the migration reused the private bucket an earlier down kept: still private, now 25 MB with the module''s file types, its file still there',
           (select not u.public and u.file_size_limit = 26214400 and u.files = 1
                   and u.allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] from _dr_up u)
    union all
    select 'D2 a bucket holding files is kept by the down, private, with none of the 4 policies left',
           (select k.files = 2 and k.public is false and k.policies = 0 from _dr_kept k)
    union all
    select 'D3 then nobody signed in reads it: visitor 0, member 0, moderator 0 files (not even the one the moderator uploaded)',
           (select count(*) = 3 and bool_and(s.n = 0) from _dr_seen s)
    union all
    select 'D4 the 3 tables and every invitation_* function are gone',
           to_regclass('public.invitation_campaign') is null and to_regclass('public.invitation_recipient') is null
           and to_regclass('public.invitation_log') is null
           and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'invitation\_%')
    union all
    select 'D5 once emptied, the down run again drops the bucket; no policy is left',
           not exists (select 1 from storage.buckets b where b.id = 'invitation-files')
           and not exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.policyname like 'invitation_files_%')
    union all
    select 'D6 everything else is as before (guest list, policies, ACLs, pins, triggers, tables, other buckets, SM26, e-mail log)',
           not exists (((select * from _dr_before except select * from pg_temp.dr_snap())
                        union all (select * from pg_temp.dr_snap() except select * from _dr_before)) except
                       (select * from pg_temp.dr_snap() where k = 'gl_event' union all select * from _dr_before where k = 'gl_event'))
  loop
    if coalesce(v_ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || E'\n' || case when coalesce(v_ok, false) then 'PASS ' else 'FAIL ' end || v_label;
  end loop;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (invitation_campaigns down dry run, run %s)', n_pass, n_fail, now()) || results;
end
$check$;
