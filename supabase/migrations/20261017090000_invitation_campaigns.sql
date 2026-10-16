-- invitation_campaigns: step 1 (part 1 of 2) of the "Invitation campaigns" admin module
-- (ticket + letter PDFs, sent by e-mail, answers followed). NOT APPLIED. Apply only with
-- Victor's OK, after its dry run: supabase/dryrun/20261017090000_invitation_campaigns.dryrun.sql.
-- Then part 2: 20261017091000_invitation_guest_link.sql (its own dry run, after this one).
-- Down: supabase/migrations/down/20261017090000_invitation_campaigns.down.sql (part 2's down
-- first). Both downs are dry-run by supabase/dryrun/20261017091000_invitation_module.down.dryrun.sql.
-- Plan: "9 M3 Connect/Module invitations - etape 0 - plan.md" (16 Oct 2026).
--
-- ADDITIVE ONLY. New: 3 tables (invitation_campaign, invitation_recipient, invitation_log),
-- 8 functions (invitation_norm, invitation_find_duplicates and 6 trigger functions), the
-- private bucket "invitation-files" and its 4 policies on storage.objects. Nothing existing
-- is redefined: no gl_* function, trigger or policy, no sm_* object, nothing of
-- organization_invitations / gl_invite_v2, none of the ops_health pinned functions.
-- New foreign keys point AT gl_event, gl_guest and profiles (ON DELETE SET NULL for the
-- last two, so a guest or account deletion elsewhere is never blocked by this module).
--
-- ONE LIST (Victor, 16 Oct): a campaign guest becomes an "invited" gl_guest row of the
-- campaign's guest-list event when the invitation goes out (part 2), so the token, the QR,
-- the door and the /wys26/guest page are the existing ones. Campaign statuses draft and
-- ready belong to staff; sent, accepted, declined and no_answer to the module's actions.
--
-- Access: verified admins and moderators only (public.is_moderator()), as gl_guest. The
-- service role (the step 4 edge function) is trusted. invitation_log is append-only for
-- everyone, owner and service role included; only the down script removes it.

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
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'invitation\_%')
     or exists (select 1 from storage.buckets b where b.id = 'invitation-files') then
    raise exception 'invitation_campaigns: already applied (or a name is taken)';
  end if;
end
$pre$;

-- 1. Name keys for duplicate checks
-- Lower case, accents folded, punctuation dropped. A person's name also loses its leading
-- titles (H.E., Dr, Mr, Eng., Sheikh...); an organisation loses every space, so "ACME S.A."
-- and "Acme SA" meet.
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
-- A campaign belongs to ONE guest-list event (gl_event; its public events row is
-- gl_event.legacy_event_id). settings: event facts (name, edition, date and place labels,
-- access, RSVP e-mail, hosts, website, contacts, letter place); texts: ticket, letter and
-- e-mail blocks with {{variables}}. Both are filled by the module (step 2 prefills the
-- first campaign from the kit's wys_dubai_2026_content.json); they live here, not in the
-- public repo, because the e-mail carries a signature and a phone number.
create table public.invitation_campaign (
  id uuid primary key default gen_random_uuid(),
  gl_event_id uuid not null references public.gl_event(id),
  name text not null check (btrim(name) <> '' and length(name) <= 200),
  ticket_style text not null default 'white' check (ticket_style in ('white', 'navy')),
  rsvp_deadline date,
  letter_date date,
  -- Access given to the guest-list row: the campaign default, a guest may override it.
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

-- One invited person of a campaign. status: draft and ready are set by staff; sent by the
-- sender (step 4); accepted, declined and no_answer only through invitation_set_answer
-- (or invitation_link_guest when it adopts a row that already answered). Names are capped
-- at gl_guest's own limits so linking never truncates. name_key / org_key are kept by
-- the trigger below.
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
  conference boolean,
  gala boolean,
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
-- 3a. Tidy a guest row (definer: it reads auth.users for the e-mail proof).
create function public.invitation_recipient_normalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_match boolean;
begin
  new.email := nullif(lower(btrim(new.email)), '');
  new.honorific := nullif(btrim(new.honorific), '');
  new.first_name := nullif(btrim(new.first_name), '');
  new.last_name := nullif(btrim(new.last_name), '');
  new.name_on_ticket := btrim(new.name_on_ticket);
  new.name_on_letter := nullif(btrim(new.name_on_letter), '');
  new.greeting := nullif(btrim(new.greeting), '');
  new.position := nullif(btrim(new.position), '');
  new.organisation := nullif(btrim(new.organisation), '');
  new.phone := nullif(btrim(new.phone), '');
  new.country := nullif(btrim(new.country), '');
  new.name_key := public.invitation_norm(
    case when coalesce(new.first_name, '') || coalesce(new.last_name, '') <> ''
         then concat_ws(' ', new.first_name, new.last_name) else new.name_on_ticket end, true);
  new.org_key := public.invitation_norm(new.organisation, false);
  if tg_op = 'INSERT' then
    -- The import flags "a verifier" / "à vérifier" / "to check" notes; staff clear it later.
    if new.notes ~* 'v.rifier|to (be )?check' then
      new.needs_check := true;
    end if;
    v_match := true;
  else
    new.updated_at := now();
    v_match := new.email is distinct from old.email;
  end if;
  -- The account with this address, only when the address is proven (Confirm email is off:
  -- anyone can sign up with someone else's address). Information only: nothing is linked.
  if v_match then
    new.profile_user_id := (
      select p.user_id from public.profiles p join auth.users u on u.id = p.user_id
       where new.email is not null and p.email_proven_at is not null
         and lower(p.email) = new.email and lower(u.email) = new.email
       order by p.user_id limit 1);
  end if;
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
  if new.gl_guest_id is distinct from old.gl_guest_id
     and not (new.gl_guest_id is null and old.status in ('draft', 'ready') and new.status in ('draft', 'ready')) then
    raise exception using errcode = '42501', message = 'invitation_recipient: the guest-list link is set by invitation_link_guest only';
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
begin
  if tg_op = 'INSERT' then
    insert into public.invitation_log (campaign_id, recipient_id, action, payload)
    values (new.campaign_id, new.id, 'recipient_added', jsonb_build_object('status', new.status));
  elsif tg_op = 'DELETE' then
    insert into public.invitation_log (campaign_id, recipient_id, action, payload)
    values (old.campaign_id, old.id, 'recipient_deleted', jsonb_build_object('status', old.status, 'gl_guest_id', old.gl_guest_id));
  else
    if new.status is distinct from old.status then
      insert into public.invitation_log (campaign_id, recipient_id, action, payload)
      values (new.campaign_id, new.id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.gl_guest_id is distinct from old.gl_guest_id then
      insert into public.invitation_log (campaign_id, recipient_id, action, payload)
      values (new.campaign_id, new.id, 'guest_link_changed', jsonb_build_object('from', old.gl_guest_id, 'to', new.gl_guest_id));
    end if;
    if new.email is distinct from old.email then
      insert into public.invitation_log (campaign_id, recipient_id, action, payload)
      values (new.campaign_id, new.id, 'email_changed', jsonb_build_object('had_email', old.email is not null, 'has_email', new.email is not null));
    end if;
  end if;
  return null;
end
$f$;

-- 3d. Campaign: updated_at; no deleting a campaign that invited someone, no moving a
-- campaign with guests to another event (API roles; invoker).
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
  if tg_op = 'DELETE' then
    if exists (select 1 from public.invitation_recipient r
                where r.campaign_id = old.id and (r.gl_guest_id is not null or r.status not in ('draft', 'ready'))) then
      raise exception using errcode = '42501',
        message = 'invitation_campaign: this campaign has invited guests; archive it instead of deleting it';
    end if;
    return old;
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
begin
  if tg_op = 'INSERT' then
    insert into public.invitation_log (campaign_id, action, payload)
    values (new.id, 'campaign_created', jsonb_build_object('gl_event_id', new.gl_event_id));
  elsif tg_op = 'DELETE' then
    insert into public.invitation_log (campaign_id, action, payload)
    values (old.id, 'campaign_deleted', jsonb_build_object('gl_event_id', old.gl_event_id));
  elsif new.archived_at is distinct from old.archived_at then
    insert into public.invitation_log (campaign_id, action)
    values (new.id, case when new.archived_at is null then 'campaign_restored' else 'campaign_archived' end);
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
create trigger invitation_campaign_a_guard before update or delete on public.invitation_campaign
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

revoke all on table public.invitation_campaign, public.invitation_recipient, public.invitation_log from anon;
revoke update, delete, truncate on table public.invitation_log from authenticated, service_role;

-- 5. Duplicates: same e-mail or same name, across the campaigns of one event and the
-- event's guest list. Shown to staff, who decide; nothing is merged. match_on: email,
-- name_org (same name and organisation) or name (same name only).
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
revoke all on function public.invitation_find_duplicates(uuid, uuid) from public, anon;
grant execute on function public.invitation_norm(text, boolean) to authenticated, service_role;
grant execute on function public.invitation_find_duplicates(uuid, uuid) to authenticated, service_role;
-- Trigger functions are never called directly.
revoke all on function public.invitation_recipient_normalize() from public, anon, authenticated;
revoke all on function public.invitation_recipient_guard() from public, anon, authenticated;
revoke all on function public.invitation_recipient_log() from public, anon, authenticated;
revoke all on function public.invitation_campaign_guard() from public, anon, authenticated;
revoke all on function public.invitation_campaign_log() from public, anon, authenticated;
revoke all on function public.invitation_log_append_only() from public, anon, authenticated;

-- 7. Private storage: generated PDFs, and private letterhead images
-- Paths: <campaign id>/<recipient id>/ticket.pdf and letter.pdf; letterhead/signature.png
-- (the handwritten signature used by the SM26 letters, uploaded once by hand). Staff
-- read them through short-lived signed URLs. NOT event-media: Yacht Club partners read
-- part of that bucket. Creating these policies locks storage.objects until commit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invitation-files', 'invitation-files', false, 26214400,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

create policy invitation_files_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'invitation-files' and (select public.is_moderator()));
create policy invitation_files_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invitation-files' and (select public.is_moderator()));
create policy invitation_files_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'invitation-files' and (select public.is_moderator()))
  with check (bucket_id = 'invitation-files' and (select public.is_moderator()));
create policy invitation_files_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'invitation-files' and (select public.is_moderator()));
