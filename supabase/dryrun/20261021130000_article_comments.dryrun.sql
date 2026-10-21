-- DRY RUN of supabase/migrations/20261021130000_article_comments.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, checks (as postgres, as a visitor (anon), as a pending
-- account, as three validated members, as the author and as M3 staff, each with set local role +
-- request.jwt.claims; first with the e-mails switch off, as on the preview before go-live, then
-- with it on), the down verbatim, checks again. Real accounts, companies and an article are only
-- READ as fixtures; every row written (the switches turned on, comments, tags, reports, notices,
-- queued e-mails) lives in this transaction only.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "62 PASS, 0 FAIL".
-- C57 and E4 compare live tables with the snapshot taken at the start: a member signing up or
-- saving their profile during the run makes them FAIL without a defect. A FAIL on C57 or E4
-- alone: run it again before stopping.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_fn on commit drop as
  select p.oid::regprocedure::text as fn, coalesce(array_to_string(p.proacl, ','), '') as acl, md5(p.prosrc) as m
    from pg_proc p where p.pronamespace = 'public'::regnamespace;
create temp table _dr_tab on commit drop as
  select 'resources'::text as t, count(*) as n, md5(coalesce(string_agg(x::text, '|' order by x.id), '')) as m from public.resources x
  union all select 'organizations', count(*), md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.organizations x
  union all select 'profiles', count(*), md5(coalesce(string_agg(x::text, '|' order by x.user_id), '')) from public.profiles x
  union all select 'organization_members', count(*), md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.organization_members x
  union all select 'notification_outbox', count(*), md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.notification_outbox x;
create temp table _dr_flag on commit drop as
  select ps.value as v from public.platform_settings ps where ps.key = 'registration_flags';
create temp table _dr_def on commit drop as
  select pg_get_constraintdef(c.oid) as d from pg_constraint c
   where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass;

-- One call as a role and an account: ok + the value as text, or the error's SQLSTATE and message.
create function pg_temp._dr_as(p_role text, p_uid uuid, p_sql text, out ok boolean, out val text, out state text, out msg text)
language plpgsql
as $dr$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into val;
    ok := true;
  exception when others then
    ok := false;
    state := sqlstate;
    msg := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$dr$;

-- B. The migration, verbatim
-- Comments under articles, with tags of people and companies (Victor, 21 Oct 2026: "les membres
-- de la plateforme peuvent mettre des commentaires sous les articles et tagger une personne ou
-- une entreprise"). Two switches: registration_flags.article_comments (the comments; on the
-- preview first, for validated members to try them) and registration_flags.article_comment_emails
-- (their e-mails; go-live only, around 4-5 Nov).
-- NOT APPLIED. Apply with Victor's OK, after the dry run
-- supabase/dryrun/20261021130000_article_comments.dryrun.sql (it runs this file, checks it as a
-- visitor, a pending account, three validated members, the author and M3 staff, then runs the
-- down, in one rolled-back transaction).
-- Down: supabase/migrations/down/20261021130000_article_comments.down.sql.
-- How to switch it on: docs/operations/article-comments.md.
--
-- ADDITIVE. Four new tables, read and written ONLY through the SECURITY DEFINER functions below
-- (no client can select, insert, update or delete a row directly), and one widened list: the
-- kinds of notification_outbox accept 'comment_mention' and 'comment_report' (the eight kinds of
-- Phase 3 stay as they are; the live site never queues the new ones). Nothing existing is
-- redefined, no policy changes, no existing table gains a column.
--
-- The rules (Victor, 21 Oct 2026):
--  - The switches, JSON true only (missing = off, as every registration switch):
--     article_comments: off, every member function refuses ('comments_off') and the public
--       count answers null, so nothing about comments shows. M3 staff can still read and moderate.
--     article_comment_emails: off, a tag or a report tells people ON THE SITE only (the
--       dashboard To do; Admin > Resources > Reported comments) and writes NO notification_outbox
--       row, so nothing can leave later either. resource_comment_email answers "out of date"
--       while either switch is off: turning one off also stops what is already queued.
--  - Only VALIDATED members (profiles.access_status = 'verified', public.is_verified()) write,
--    tag, report and read the comments with their authors' names. A visitor or an account M3 has
--    not validated gets the number of comments only (resource_comment_count).
--  - Published at once, no pre-moderation. M3 staff (public.is_moderator()) hide or show again a
--    comment at any time; every member may report a comment once; each report e-mails the M3
--    team (verified admins and moderators), one e-mail each (e-mails switch on). A report keeps
--    the text as it was (body_snapshot, M3 only), and the author cannot edit a comment while a
--    report on it is open ('comment_under_review'): the evidence stays.
--  - Only on an article the reader may read: published and public.can_access_resource(level).
--  - Tags: in the stored text a tag is "@[Name](user:<uuid>)" or "@[Name](org:<uuid>)". The
--    server checks every tag: a validated person, or a verified company that is not archived and
--    not merged; the name is rewritten from the database (nobody can tag X under Y's name); a
--    tag that does not check out becomes plain text "@Name", and the text is checked again until
--    nothing changes (a tag hidden inside another is checked too). At most 5 tags per comment.
--  - A tagged person, or for a tagged company its owners (organization_members role owner, or
--    organizations.owner_user_id; up to 3; a company without an owner: up to 3 of its validated
--    members), is told on the site (resource_comment_notice: the dashboard's To do) and, while
--    the e-mails are on, by one e-mail (notification_outbox 'comment_mention', sent at once by
--    send-notification when the author's page asks for it, else by registration-cron's outbox
--    job). Never the author; one notice per person and comment, ever; one e-mail per person and
--    comment, and at most one a day from the same author to the same person; only validated
--    members who may read the article. An edit that adds a tag tells the new people only; a
--    removed tag or a deleted comment withdraws the notice (kept: it still counts for the limit;
--    a tag put back brings it back as it was, with no new e-mail).
--  - Limits: 2000 characters of text, 10 comments an hour per member, 60 people told a day per
--    author (every notice made in the last 24 hours counts, withdrawn ones too), 20 reports a
--    day per member.
--  - Edit: the author, any time, while the comment is neither hidden nor under review; it then
--    shows "edited". Delete: the author; the text is erased at once (the row stays, empty, so
--    the hourly limit and M3's report list still count it; a report keeps its own copy).
--  - E-mail opt-out: send-notification files comment_mention under the new category
--    "comments" (notification_prefs.comments = false stops them) and comment_report under
--    "admin". resource_comment_email(outbox id) gives the sender every word of the e-mail
--    from the database (service role only) and says when the news is out of date (comment
--    deleted or hidden, tag removed, report already handled, a switch off, the recipient no
--    longer allowed to read the article).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_def text;
begin
  if to_regclass('public.resource_comment') is not null or to_regclass('public.resource_comment_mention') is not null
     or to_regclass('public.resource_comment_report') is not null or to_regclass('public.resource_comment_notice') is not null then
    raise exception 'article_comments: already installed';
  end if;
  -- The helpers it relies on, as they were on 21 Oct 2026.
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.is_moderator()')) is distinct from 'cb9c826f94db460c5b63f9830ae12361'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.is_verified()')) is distinct from '214e898a9ba2cb77ec5b1677fbd0183e'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.can_access_resource(text)')) is distinct from '2fcf0a1a840a7be68a2fc2467a408c6e' then
    raise exception 'article_comments: is_moderator(), is_verified() or can_access_resource() changed since 21 Oct; check them again';
  end if;
  if to_regprocedure('public.partner_request_user_org(uuid,uuid)') is null or to_regprocedure('public.smc_fold(text)') is null
     or to_regclass('public.notification_outbox') is null or to_regclass('public.platform_settings') is null then
    raise exception 'article_comments: partner_request_user_org, smc_fold, notification_outbox or platform_settings missing';
  end if;
  if not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'resources' and c.column_name = 'slug')
     or not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'duplicate_of')
     or not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'organizations' and c.column_name = 'name_search') then
    raise exception 'article_comments: resources.slug, organizations.duplicate_of or organizations.name_search missing';
  end if;
  -- The outbox kinds are replaced by a fixed list below: refuse if another file changed them
  -- since Phase 3 (they would be lost silently; merge the lists first).
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass;
  if v_def is distinct from 'CHECK ((kind = ANY (ARRAY[''account_under_review''::text, ''team_join_request''::text, ''user_account_approved''::text, ''user_account_rejected''::text, ''account_info_requested''::text, ''company_validated''::text, ''claim_approved''::text, ''claim_declined''::text])))' then
    raise exception 'article_comments: notification_outbox kinds changed (%); merge the lists in this file', v_def;
  end if;
end
$pre$;

-- ---- 1. Tables (no client access: the functions below only) ------------------------------

create table public.resource_comment (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  -- The company the author spoke for when posting (partner_request_user_org).
  author_org_id uuid references public.organizations(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid references auth.users(id) on delete set null,
  hidden_reason text,
  constraint resource_comment_body_len check (case when deleted_at is null then char_length(body) between 1 and 4000 else body = '' end),
  constraint resource_comment_hidden_reason_len check (hidden_reason is null or char_length(hidden_reason) <= 500)
);
create index resource_comment_resource_idx on public.resource_comment (resource_id, created_at);
create index resource_comment_author_idx on public.resource_comment (author_user_id, created_at);
comment on table public.resource_comment is
  'Comments under articles (resources), by validated members. Read and written only through the resource_comment_* functions. A deleted comment keeps its row with an empty body. 20261021130000.';

create table public.resource_comment_mention (
  id bigint generated always as identity primary key,
  comment_id uuid not null references public.resource_comment(id) on delete cascade,
  mentioned_user_id uuid references auth.users(id) on delete cascade,
  mentioned_org_id uuid references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint resource_comment_mention_one check (num_nonnulls(mentioned_user_id, mentioned_org_id) = 1),
  constraint resource_comment_mention_user_key unique (comment_id, mentioned_user_id),
  constraint resource_comment_mention_org_key unique (comment_id, mentioned_org_id)
);
create index resource_comment_mention_user_idx on public.resource_comment_mention (mentioned_user_id) where mentioned_user_id is not null;
create index resource_comment_mention_org_idx on public.resource_comment_mention (mentioned_org_id) where mentioned_org_id is not null;
comment on table public.resource_comment_mention is
  'The people and companies a comment tags (one of the two per row), checked by the server. 20261021130000.';

create table public.resource_comment_report (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.resource_comment(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  -- The text as it was when reported (M3 only): an edit or a delete by its author cannot erase it.
  body_snapshot text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution text,
  constraint resource_comment_report_once unique (comment_id, reporter_user_id),
  constraint resource_comment_report_reason_len check (reason is null or char_length(reason) <= 500),
  constraint resource_comment_report_snapshot_len check (char_length(body_snapshot) <= 4000),
  constraint resource_comment_report_resolution check (resolution is null or resolution in ('hidden', 'kept', 'deleted')),
  constraint resource_comment_report_resolved check ((resolved_at is null) = (resolution is null))
);
create index resource_comment_report_open_idx on public.resource_comment_report (created_at) where resolved_at is null;
create index resource_comment_report_reporter_idx on public.resource_comment_report (reporter_user_id, created_at);
comment on table public.resource_comment_report is
  'Members reporting a comment to M3 (once each), with the text as it was (body_snapshot). Closed when M3 hides the comment (hidden), keeps it (kept), or its author deletes it (deleted). 20261021130000.';

create table public.resource_comment_notice (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  comment_id uuid not null references public.resource_comment(id) on delete cascade,
  -- Told because their company was tagged (null: tagged by name).
  via_org_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  -- The tag was removed or the comment deleted: not shown any more, but kept (the daily limit
  -- counts it; the tag put back brings the same notice back, seen or not, with no new e-mail).
  withdrawn_at timestamptz,
  constraint resource_comment_notice_once unique (user_id, comment_id)
);
create index resource_comment_notice_unseen_idx on public.resource_comment_notice (user_id, created_at) where seen_at is null and withdrawn_at is null;
create index resource_comment_notice_comment_idx on public.resource_comment_notice (comment_id);
comment on table public.resource_comment_notice is
  'On-site notice "you were tagged in a comment" (the dashboard To do), one per person and comment, ever (withdrawn_at: tag removed or comment deleted); also the list of people e-mailed and the daily limit. 20261021130000.';

alter table public.resource_comment enable row level security;
alter table public.resource_comment_mention enable row level security;
alter table public.resource_comment_report enable row level security;
alter table public.resource_comment_notice enable row level security;
revoke all on table public.resource_comment, public.resource_comment_mention, public.resource_comment_report, public.resource_comment_notice
  from public, anon, authenticated;
grant all on table public.resource_comment, public.resource_comment_mention, public.resource_comment_report, public.resource_comment_notice
  to service_role;
revoke all on sequence public.resource_comment_mention_id_seq, public.resource_comment_notice_id_seq from public, anon, authenticated;
grant usage, select on sequence public.resource_comment_mention_id_seq, public.resource_comment_notice_id_seq to service_role;

-- ---- 2. The outbox accepts the two comment e-mails ---------------------------------------

alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'account_under_review', 'team_join_request',
  'user_account_approved', 'user_account_rejected', 'account_info_requested', 'company_validated',
  'claim_approved', 'claim_declined',
  'comment_mention', 'comment_report'));

-- ---- 3. Helpers (no grant: called by the functions below only) ---------------------------

-- The switch: registration_flags.article_comments, JSON true only.
create function public.resource_comments_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((select (ps.value -> 'article_comments') = 'true'::jsonb
                     from public.platform_settings ps where ps.key = 'registration_flags'), false)
$fn$;

-- The e-mails switch: registration_flags.article_comment_emails, JSON true only. Off (until
-- go-live): tags and reports tell people on the site only, no notification_outbox row at all.
create function public.resource_comment_emails_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((select (ps.value -> 'article_comment_emails') = 'true'::jsonb
                     from public.platform_settings ps where ps.key = 'registration_flags'), false)
$fn$;

-- The caller, once the switch is on and the caller is a validated member (else an error).
-- p_staff_read: M3 staff pass even with the switch off (reading and moderating only).
-- p_resource_id (optional): the article must be readable by the caller.
create function public.resource_comment_gate(p_resource_id uuid, p_staff_read boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_staff boolean := public.is_moderator();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'comment_not_signed_in';
  end if;
  if not (p_staff_read and v_staff) then
    if not public.resource_comments_on() then
      raise exception using errcode = 'P0001', message = 'comments_off';
    end if;
    if not public.is_verified() then
      raise exception using errcode = '42501', message = 'comment_not_validated';
    end if;
  end if;
  if p_resource_id is not null and not exists (
       select 1 from public.resources r
        where r.id = p_resource_id
          and (v_staff or (r.published = true and public.can_access_resource(r.access_level)))) then
    raise exception using errcode = 'P0001', message = 'comment_article_unavailable';
  end if;
  return v_uid;
end
$fn$;

-- M3 staff only (else an error).
create function public.resource_comment_staff()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null or not public.is_moderator() then
    raise exception using errcode = '42501', message = 'comment_not_staff';
  end if;
  return auth.uid();
end
$fn$;

-- Whether a validated person may read an article of this access level (can_access_resource,
-- for someone else than the caller: 'members' = the marketplace personas, 'marina' = marinas;
-- M3 staff always). Used to tell only people who can open the link.
create function public.resource_comment_reader_ok(p_uid uuid, p_access_level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select case lower(coalesce(nullif(btrim(p_access_level), ''), 'public'))
    when 'public' then true
    when 'marina' then exists (select 1 from public.profiles p
                                where p.user_id = p_uid and p.access_status = 'verified' and p.persona in ('marina', 'admin', 'moderator'))
    else exists (select 1 from public.profiles p
                  where p.user_id = p_uid and p.access_status = 'verified'
                    and p.persona in ('marina', 'partner', 'media_partner', 'admin', 'moderator'))
  end
$fn$;

-- Typed text: no carriage return, no control character but line breaks and tabs, trimmed, capped.
create function public.resource_comment_clean(p text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select left(btrim(regexp_replace(replace(coalesce(p, ''), chr(13), ''),
                                   '[' || chr(1) || '-' || chr(8) || chr(11) || '-' || chr(31) || chr(127) || ']', '', 'g')), p_max)
$fn$;

-- A name as a tag label: one line, no square brackets or parentheses.
create function public.resource_comment_label(p text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[][()[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), 120)
$fn$;

-- The text as people read it: every tag becomes "@Name".
create function public.resource_comment_plain(p_body text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select regexp_replace(coalesce(p_body, ''), '@\[([^][[:cntrl:]]{1,120})\]\((user|org):[0-9a-fA-F-]{36}\)', '@\1', 'g')
$fn$;

-- The first words of a comment, on one line (e-mails, the dashboard).
create function public.resource_comment_excerpt(p_body text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case when char_length(x.t) > p_max then rtrim(left(x.t, p_max - 3)) || '...' else x.t end
    from (select btrim(regexp_replace(public.resource_comment_plain(p_body), '\s+', ' ', 'g')) as t) x
$fn$;

-- The text to store and the people and companies it tags, after checking every tag (header).
-- The check runs again until the text no longer changes: turning a bad tag into "@Name" can
-- make a new tag of the text around it ("@[@[Z](user:bad)](user:x)" gives "@[@Z](user:x)"),
-- which the next round checks. Valid tags are rewritten to themselves on the second round, so a
-- plain comment needs two; a text still changing after three is refused ('comment_bad_tag').
create function public.resource_comment_prepare(p_body text, out o_body text, out o_people uuid[], out o_orgs uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_body text := public.resource_comment_clean(p_body, 6000);
  v_prev text;
  v_round integer;
  v_m text[];
  v_tok text;
  v_id uuid;
  v_label text;
  v_plain integer;
begin
  o_people := '{}';
  o_orgs := '{}';
  for v_round in 1..3 loop
    v_prev := v_body;
    for v_m in
      select regexp_matches(v_body, '@\[([^][[:cntrl:]]{1,120})\]\((user|org):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)', 'g')
    loop
      v_tok := '@[' || v_m[1] || '](' || v_m[2] || ':' || v_m[3] || ')';
      v_id := v_m[3]::uuid;
      v_label := null;
      if v_m[2] = 'user' then
        select public.resource_comment_label(concat_ws(' ', p.first_name, p.last_name)) into v_label
          from public.profiles p where p.user_id = v_id and p.access_status = 'verified';
        if coalesce(v_label, '') <> '' and not (v_id = any(o_people)) then
          o_people := o_people || v_id;
        end if;
      else
        select public.resource_comment_label(o.name) into v_label
          from public.organizations o
         where o.id = v_id and o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null;
        if coalesce(v_label, '') <> '' and not (v_id = any(o_orgs)) then
          o_orgs := o_orgs || v_id;
        end if;
      end if;
      if coalesce(v_label, '') = '' then
        v_body := replace(v_body, v_tok, '@' || v_m[1]);
      else
        v_body := replace(v_body, v_tok, '@[' || v_label || '](' || v_m[2] || ':' || v_id::text || ')');
      end if;
    end loop;
    exit when v_body = v_prev;
  end loop;
  if v_body <> v_prev then
    raise exception using errcode = 'P0001', message = 'comment_bad_tag';
  end if;
  v_plain := char_length(btrim(public.resource_comment_plain(v_body)));
  if v_plain = 0 then
    raise exception using errcode = 'P0001', message = 'comment_empty';
  end if;
  if v_plain > 2000 or char_length(v_body) > 4000 then
    raise exception using errcode = 'P0001', message = 'comment_too_long';
  end if;
  if cardinality(o_people) + cardinality(o_orgs) > 5 then
    raise exception using errcode = 'P0001', message = 'comment_too_many_tags';
  end if;
  o_body := v_body;
end
$fn$;

-- Who is told about a comment (header): the people it tags, and up to 3 owners of each company
-- it tags (3 validated members when the company has no owner); validated, able to read the
-- article, never the author, once each (tagged by name wins over through a company).
create function public.resource_comment_recipients(p_comment_id uuid)
returns table (user_id uuid, via_org_id uuid)
language sql
stable
security definer
set search_path = ''
as $fn$
  with c as (
    select rc.id, rc.author_user_id, r.access_level
      from public.resource_comment rc
      join public.resources r on r.id = rc.resource_id
     where rc.id = p_comment_id and rc.deleted_at is null and rc.hidden_at is null
  ),
  people as (
    select m.mentioned_user_id as uid, null::uuid as via, 0 as prio
      from public.resource_comment_mention m
      join c on c.id = m.comment_id
     where m.mentioned_user_id is not null
  ),
  members as (
    select mm.user_id as uid, o.id as via,
           (coalesce(o.owner_user_id = mm.user_id, false) or mm.role = 'owner') as is_owner,
           row_number() over (partition by o.id
                              order by coalesce(o.owner_user_id = mm.user_id, false) desc, (mm.role = 'owner') desc, mm.joined_at, mm.user_id) as rn
      from public.resource_comment_mention m
      join c on c.id = m.comment_id
      join public.organizations o
        on o.id = m.mentioned_org_id and o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null
      join public.organization_members mm on mm.organization_id = o.id
      join public.profiles p on p.user_id = mm.user_id and p.access_status = 'verified'
  ),
  companies as (
    select x.uid, x.via, 1 as prio
      from (select mb.uid, mb.via, mb.is_owner, mb.rn, bool_or(mb.is_owner) over (partition by mb.via) as has_owner
              from members mb) x
     where x.rn <= 3 and (x.is_owner or not x.has_owner)
  )
  select distinct on (t.uid) t.uid, t.via
    from (select pe.uid, pe.via, pe.prio from people pe
          union all
          select co.uid, co.via, co.prio from companies co) t
    cross join c
    join public.profiles p on p.user_id = t.uid and p.access_status = 'verified'
   where t.uid is distinct from c.author_user_id
     and public.resource_comment_reader_ok(t.uid, c.access_level)
   order by t.uid, t.prio
$fn$;

-- The notices and e-mails of a comment, after a post or an edit (header): people no longer told
-- have their notice withdrawn (kept, so it still counts below); people told again get the same
-- notice back as it was (seen or not), with no new e-mail; new people get a notice and, while the
-- e-mails are on, one queued e-mail, unless the same author already e-mailed them in the last 24
-- hours (any comment; the outbox rows are never deleted, only settled). Returns the number of
-- e-mails queued. Over 60 notices made in 24 hours for one author's comments: refused (the whole
-- post or edit with it). Every count here is of rows nothing deletes, so deleting or editing a
-- comment never makes room for more.
create function public.resource_comment_notify(p_comment_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_author uuid;
  v_emails boolean := public.resource_comment_emails_on();
  v_n integer := 0;
  v_day integer;
begin
  select rc.author_user_id into v_author from public.resource_comment rc where rc.id = p_comment_id;
  update public.resource_comment_notice n set withdrawn_at = now()
   where n.comment_id = p_comment_id and n.withdrawn_at is null
     and not exists (select 1 from public.resource_comment_recipients(p_comment_id) r where r.user_id = n.user_id);
  update public.resource_comment_notice n set withdrawn_at = null, via_org_id = r.via_org_id
    from public.resource_comment_recipients(p_comment_id) r
   where n.comment_id = p_comment_id and n.user_id = r.user_id and n.withdrawn_at is not null;
  with ins as (
    insert into public.resource_comment_notice (user_id, comment_id, via_org_id)
    select r.user_id, p_comment_id, r.via_org_id from public.resource_comment_recipients(p_comment_id) r
    on conflict on constraint resource_comment_notice_once do nothing
    returning resource_comment_notice.user_id as uid
  )
  insert into public.notification_outbox (kind, user_id, actor_id, subject_id, dedupe_key, data)
  select 'comment_mention', i.uid, v_author, p_comment_id,
         'comment_mention:' || p_comment_id::text || ':' || i.uid::text,
         jsonb_build_object('comment_id', p_comment_id)
    from ins i
   where v_emails
     and not exists (select 1 from public.notification_outbox o
                      where o.kind = 'comment_mention' and o.actor_id = v_author and o.user_id = i.uid
                        and o.created_at > now() - interval '24 hours')
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  select count(*) into v_day
    from public.resource_comment_notice n
    join public.resource_comment rc on rc.id = n.comment_id
   where rc.author_user_id = v_author and n.created_at > now() - interval '24 hours';
  if v_day > 60 then
    raise exception using errcode = 'P0001', message = 'comment_tag_limit';
  end if;
  return v_n;
end
$fn$;

-- ---- 4. Members ---------------------------------------------------------------------------

-- Post a comment. Returns {id, emails}: emails = e-mails queued for the people tagged, always 0
-- while the e-mails are off (the page then asks send-notification to send them: type
-- comment_mention, data.comment_id).
create function public.resource_comment_post(p_resource_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid;
  v_prep record;
  v_id uuid;
  v_n integer;
begin
  v_uid := public.resource_comment_gate(p_resource_id, false);
  if (select count(*) from public.resource_comment rc
       where rc.author_user_id = v_uid and rc.created_at > now() - interval '1 hour') >= 10 then
    raise exception using errcode = 'P0001', message = 'comment_rate_limited';
  end if;
  select * into v_prep from public.resource_comment_prepare(p_body);
  insert into public.resource_comment (resource_id, author_user_id, author_org_id, body)
  values (p_resource_id, v_uid, public.partner_request_user_org(v_uid, null), v_prep.o_body)
  returning id into v_id;
  insert into public.resource_comment_mention (comment_id, mentioned_user_id)
  select v_id, x.id from unnest(v_prep.o_people) as x(id);
  insert into public.resource_comment_mention (comment_id, mentioned_org_id)
  select v_id, x.id from unnest(v_prep.o_orgs) as x(id);
  v_n := public.resource_comment_notify(v_id);
  return jsonb_build_object('id', v_id, 'emails', v_n);
end
$fn$;

-- Edit my comment (not once M3 hid it, nor while a report on it is open: M3 judges the text
-- that was reported). Returns {id, emails, changed}.
create function public.resource_comment_edit(p_comment_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid;
  v_c record;
  v_prep record;
  v_n integer;
begin
  v_uid := public.resource_comment_gate(null, false);
  select rc.id, rc.resource_id, rc.author_user_id, rc.body, rc.deleted_at, rc.hidden_at into v_c
    from public.resource_comment rc where rc.id = p_comment_id for update;
  if not found or v_c.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'comment_not_found';
  end if;
  if v_c.author_user_id <> v_uid then
    raise exception using errcode = '42501', message = 'comment_not_yours';
  end if;
  if v_c.hidden_at is not null then
    raise exception using errcode = 'P0001', message = 'comment_hidden';
  end if;
  if exists (select 1 from public.resource_comment_report rp where rp.comment_id = p_comment_id and rp.resolved_at is null) then
    raise exception using errcode = 'P0001', message = 'comment_under_review';
  end if;
  perform public.resource_comment_gate(v_c.resource_id, false);
  select * into v_prep from public.resource_comment_prepare(p_body);
  if v_prep.o_body = v_c.body then
    return jsonb_build_object('id', p_comment_id, 'emails', 0, 'changed', false);
  end if;
  update public.resource_comment rc set body = v_prep.o_body, edited_at = now() where rc.id = p_comment_id;
  delete from public.resource_comment_mention m
   where m.comment_id = p_comment_id
     and not (coalesce(m.mentioned_user_id = any(v_prep.o_people), false) or coalesce(m.mentioned_org_id = any(v_prep.o_orgs), false));
  insert into public.resource_comment_mention (comment_id, mentioned_user_id)
  select p_comment_id, x.id from unnest(v_prep.o_people) as x(id)
  on conflict do nothing;
  insert into public.resource_comment_mention (comment_id, mentioned_org_id)
  select p_comment_id, x.id from unnest(v_prep.o_orgs) as x(id)
  on conflict do nothing;
  v_n := public.resource_comment_notify(p_comment_id);
  return jsonb_build_object('id', p_comment_id, 'emails', v_n, 'changed', true);
end
$fn$;

-- Delete my comment: the text is erased, the tags go, the notices are withdrawn (kept for the
-- daily limit), unsent e-mails are settled, open reports close (each keeps its copy of the text).
create function public.resource_comment_delete(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid;
  v_c record;
begin
  v_uid := public.resource_comment_gate(null, false);
  select rc.id, rc.author_user_id, rc.deleted_at into v_c from public.resource_comment rc where rc.id = p_comment_id for update;
  if not found or v_c.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'comment_not_found';
  end if;
  if v_c.author_user_id <> v_uid then
    raise exception using errcode = '42501', message = 'comment_not_yours';
  end if;
  update public.resource_comment rc set deleted_at = now(), body = '' where rc.id = p_comment_id;
  delete from public.resource_comment_mention m where m.comment_id = p_comment_id;
  update public.resource_comment_notice n set withdrawn_at = now() where n.comment_id = p_comment_id and n.withdrawn_at is null;
  update public.resource_comment_report rp set resolved_at = now(), resolution = 'deleted'
   where rp.comment_id = p_comment_id and rp.resolved_at is null;
  update public.notification_outbox o set sent_at = now(), last_error = 'not sent: the comment was deleted'
   where o.sent_at is null
     and ((o.kind = 'comment_mention' and o.subject_id = p_comment_id)
          or (o.kind = 'comment_report' and o.subject_id in (select rp.id from public.resource_comment_report rp where rp.comment_id = p_comment_id)));
  return true;
end
$fn$;

-- Report a comment to M3 (once), keeping a copy of its text. Returns {report_id, emails,
-- already}: emails = e-mails queued for the M3 team while the e-mails are on (the page then asks
-- send-notification: type comment_report, data.report_id); with them off, M3 finds the report in
-- Admin > Resources > Reported comments only.
create function public.resource_comment_report(p_comment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid;
  v_c record;
  v_rid uuid;
  v_n integer := 0;
begin
  v_uid := public.resource_comment_gate(null, false);
  select rc.id, rc.resource_id, rc.author_user_id, rc.body, rc.deleted_at, rc.hidden_at into v_c
    from public.resource_comment rc where rc.id = p_comment_id;
  if not found or v_c.deleted_at is not null or v_c.hidden_at is not null then
    raise exception using errcode = 'P0001', message = 'comment_not_found';
  end if;
  perform public.resource_comment_gate(v_c.resource_id, false);
  if v_c.author_user_id = v_uid then
    raise exception using errcode = 'P0001', message = 'comment_report_own';
  end if;
  if exists (select 1 from public.resource_comment_report rp where rp.comment_id = p_comment_id and rp.reporter_user_id = v_uid) then
    return jsonb_build_object('report_id', null, 'emails', 0, 'already', true);
  end if;
  if (select count(*) from public.resource_comment_report rp
       where rp.reporter_user_id = v_uid and rp.created_at > now() - interval '24 hours') >= 20 then
    raise exception using errcode = 'P0001', message = 'comment_report_rate_limited';
  end if;
  insert into public.resource_comment_report (comment_id, reporter_user_id, reason, body_snapshot)
  values (p_comment_id, v_uid, nullif(public.resource_comment_clean(p_reason, 500), ''), v_c.body)
  on conflict on constraint resource_comment_report_once do nothing
  returning id into v_rid;
  if v_rid is null then
    return jsonb_build_object('report_id', null, 'emails', 0, 'already', true);
  end if;
  if public.resource_comment_emails_on() then
    insert into public.notification_outbox (kind, user_id, actor_id, subject_id, dedupe_key, data)
    select 'comment_report', p.user_id, v_uid, v_rid,
           'comment_report:' || v_rid::text || ':' || p.user_id::text,
           jsonb_build_object('comment_id', p_comment_id)
      from public.profiles p
     where p.persona in ('admin', 'moderator') and p.access_status = 'verified' and p.user_id <> v_uid
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('report_id', v_rid, 'emails', v_n, 'already', false);
end
$fn$;

-- The comments of an article, oldest first, with their authors and tags. Validated members:
-- the visible ones, and their own even when M3 hid them (marked hidden). M3 staff: all of them,
-- hidden ones included, with the number of open reports (even with the switch off).
create function public.resource_comments_list(p_resource_id uuid)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  edited_at timestamptz,
  is_mine boolean,
  hidden boolean,
  hidden_reason text,
  author_user_id uuid,
  author_name text,
  author_job_title text,
  author_avatar_url text,
  author_org_name text,
  author_org_slug text,
  author_org_logo_url text,
  author_org_type text,
  mentions jsonb,
  open_reports integer,
  reported_by_me boolean,
  my_notice_id bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.resource_comment_gate(p_resource_id, true);
  select c.id,
         c.body,
         c.created_at,
         c.edited_at,
         c.author_user_id = auth.uid(),
         c.hidden_at is not null,
         case when public.is_moderator() or c.author_user_id = auth.uid() then c.hidden_reason end,
         case when public.is_moderator() then c.author_user_id end,
         coalesce(nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''), 'A member'),
         nullif(btrim(coalesce(ap.job_title, '')), ''),
         ap.avatar_url,
         ao.name,
         ao.slug,
         ao.logo_url,
         ao.organization_type,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'kind', case when m.mentioned_user_id is not null then 'person' else 'company' end,
                    'id', coalesce(m.mentioned_user_id, m.mentioned_org_id),
                    'name', case when m.mentioned_user_id is not null then btrim(concat_ws(' ', mp.first_name, mp.last_name)) else mo.name end,
                    'slug', mo.slug,
                    'org_name', case when m.mentioned_user_id is not null then mo.name end)
                  order by m.id)
             from public.resource_comment_mention m
             left join public.profiles mp on mp.user_id = m.mentioned_user_id and mp.access_status = 'verified'
             left join public.organizations mo
               on mo.id = coalesce(m.mentioned_org_id, public.partner_request_user_org(m.mentioned_user_id, null))
              and mo.access_status = 'verified' and mo.archived_at is null and mo.duplicate_of is null
            where m.comment_id = c.id
              and (mp.user_id is not null or (m.mentioned_org_id is not null and mo.id is not null))), '[]'::jsonb),
         case when public.is_moderator() then
           (select count(*)::integer from public.resource_comment_report rp where rp.comment_id = c.id and rp.resolved_at is null) end,
         exists (select 1 from public.resource_comment_report rp where rp.comment_id = c.id and rp.reporter_user_id = auth.uid()),
         (select n.id from public.resource_comment_notice n
           where n.comment_id = c.id and n.user_id = auth.uid() and n.seen_at is null and n.withdrawn_at is null)
    from public.resource_comment c
    left join public.profiles ap on ap.user_id = c.author_user_id
    left join public.organizations ao
      on ao.id = c.author_org_id and ao.access_status = 'verified' and ao.archived_at is null and ao.duplicate_of is null
   where c.resource_id = p_resource_id
     and c.deleted_at is null
     and (c.hidden_at is null or public.is_moderator() or c.author_user_id = auth.uid())
   order by c.created_at, c.id
   limit 500;
$fn$;

-- The number of visible comments of an article, for everyone (visitors included); null while
-- the switch is off or when the caller may not read the article.
create function public.resource_comment_count(p_resource_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
           when public.resource_comments_on()
            and exists (select 1 from public.resources r
                         where r.id = p_resource_id and r.published = true and public.can_access_resource(r.access_level))
           then (select count(*)::integer from public.resource_comment c
                  where c.resource_id = p_resource_id and c.deleted_at is null and c.hidden_at is null)
         end
$fn$;

-- The tag suggestions while typing "@...": up to 4 validated people (with their job and company)
-- and 4 verified companies whose name contains the text typed (2 characters at least; accents,
-- case and curly apostrophes ignored). Names starting with it first. Never the caller.
create function public.resource_comment_mention_search(p_query text)
returns table (kind text, id uuid, label text, detail text, image_url text, org_slug text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.resource_comment_gate(null, false);
  with q as (
    select left(public.smc_fold(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'))), 60) as f
  ),
  pat as (
    select replace(replace(replace(q.f, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') as e
      from q where char_length(q.f) >= 2
  ),
  co as (
    select o.id, o.name as label, o.organization_type, o.country, o.logo_url, o.slug,
           case when o.name_search like pat.e || '%' then 0 else 1 end as rnk
      from public.organizations o cross join pat
     where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null
       and o.name_search like '%' || pat.e || '%'
     order by 7, o.name
     limit 4
  ),
  pe as (
    select p.user_id as id, btrim(concat_ws(' ', p.first_name, p.last_name)) as label, p.job_title, p.avatar_url,
           case when public.smc_fold(btrim(concat_ws(' ', p.first_name, p.last_name))) like pat.e || '%'
                  or public.smc_fold(coalesce(p.last_name, '')) like pat.e || '%' then 0 else 1 end as rnk
      from public.profiles p cross join pat
     where p.access_status = 'verified'
       and p.user_id <> auth.uid()
       and btrim(concat_ws(' ', p.first_name, p.last_name)) <> ''
       and public.smc_fold(btrim(concat_ws(' ', p.first_name, p.last_name))) like '%' || pat.e || '%'
     order by 5, 2
     limit 4
  ),
  allx as (
    select 'company'::text as k, co.id as i, co.label as l,
           nullif(concat_ws(' ' || chr(183) || ' ', case co.organization_type when 'marina' then 'Marina' when 'partner' then 'Partner'
                                                              when 'investor' then 'Investor' when 'developer' then 'Developer'
                                                              when 'media_partner' then 'Media partner' end,
                                   nullif(btrim(coalesce(co.country, '')), '')), '') as d,
           co.logo_url as img, co.slug as s, co.rnk as r, 1 as ord
      from co
    union all
    select 'person'::text, pe.id, pe.label,
           nullif(concat_ws(' ' || chr(183) || ' ', nullif(btrim(coalesce(pe.job_title, '')), ''), po.name), ''),
           pe.avatar_url, po.slug, pe.rnk, 0
      from pe
      left join public.organizations po
        on po.id = public.partner_request_user_org(pe.id, null)
       and po.access_status = 'verified' and po.archived_at is null and po.duplicate_of is null
  )
  select a.k, a.i, a.l, a.d, a.img, a.s from allx a order by a.r, a.ord, a.l limit 8;
$fn$;

-- My notices "you were tagged in a comment" not seen yet (newest first, 20 at most): not
-- withdrawn, on a visible comment, under an article I may still read.
create function public.resource_comment_my_notices()
returns table (
  notice_id bigint,
  comment_id uuid,
  resource_id uuid,
  resource_slug text,
  resource_title text,
  author_name text,
  author_org_name text,
  via_org_name text,
  excerpt text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.resource_comment_gate(null, false);
  select n.id, c.id, r.id, r.slug, r.title,
         coalesce(nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''), 'A member'),
         ao.name,
         vo.name,
         public.resource_comment_excerpt(c.body, 160),
         n.created_at
    from public.resource_comment_notice n
    join public.resource_comment c on c.id = n.comment_id and c.deleted_at is null and c.hidden_at is null
    join public.resources r on r.id = c.resource_id and r.published = true and public.can_access_resource(r.access_level)
    left join public.profiles ap on ap.user_id = c.author_user_id
    left join public.organizations ao
      on ao.id = c.author_org_id and ao.access_status = 'verified' and ao.archived_at is null and ao.duplicate_of is null
    left join public.organizations vo on vo.id = n.via_org_id
   where n.user_id = auth.uid() and n.seen_at is null and n.withdrawn_at is null
   order by n.created_at desc, n.id desc
   limit 20;
$fn$;

-- Mark my notices seen: those named, or all of them (null). Returns how many changed.
create function public.resource_comment_mark_seen(p_notice_ids bigint[])
returns integer
language sql
security definer
set search_path = ''
as $fn$
  select public.resource_comment_gate(null, false);
  with u as (
    update public.resource_comment_notice n set seen_at = now()
     where n.user_id = auth.uid() and n.seen_at is null and n.withdrawn_at is null
       and (p_notice_ids is null or n.id = any(p_notice_ids))
    returning 1
  )
  select count(*)::integer from u;
$fn$;

-- ---- 5. M3 staff (is_moderator; also with the switch off) --------------------------------

-- 'hide' (with an optional reason shown to its author), 'unhide', or 'keep' (the reports are
-- closed, the comment stays). Hiding closes the open reports too.
create function public.admin_resource_comment_moderate(p_comment_id uuid, p_action text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid;
  v_c record;
begin
  v_uid := public.resource_comment_staff();
  if p_action is null or p_action not in ('hide', 'unhide', 'keep') then
    raise exception using errcode = 'P0001', message = 'comment_bad_action';
  end if;
  select rc.id, rc.deleted_at into v_c from public.resource_comment rc where rc.id = p_comment_id for update;
  if not found or (v_c.deleted_at is not null and p_action <> 'keep') then
    raise exception using errcode = 'P0001', message = 'comment_not_found';
  end if;
  if p_action = 'hide' then
    update public.resource_comment rc
       set hidden_at = coalesce(rc.hidden_at, now()), hidden_by = v_uid,
           hidden_reason = nullif(public.resource_comment_clean(p_reason, 500), '')
     where rc.id = p_comment_id;
    update public.notification_outbox o set sent_at = now(), last_error = 'not sent: M3 hid the comment'
     where o.sent_at is null and o.kind = 'comment_mention' and o.subject_id = p_comment_id;
  elsif p_action = 'unhide' then
    update public.resource_comment rc set hidden_at = null, hidden_by = null, hidden_reason = null where rc.id = p_comment_id;
  end if;
  if p_action in ('hide', 'keep') then
    update public.notification_outbox o set sent_at = now(), last_error = 'not sent: M3 already dealt with the report'
     where o.sent_at is null and o.kind = 'comment_report'
       and o.subject_id in (select rp.id from public.resource_comment_report rp where rp.comment_id = p_comment_id and rp.resolved_at is null);
    update public.resource_comment_report rp
       set resolved_at = now(), resolved_by = v_uid, resolution = case when p_action = 'hide' then 'hidden' else 'kept' end
     where rp.comment_id = p_comment_id and rp.resolved_at is null;
  end if;
  return true;
end
$fn$;

-- The reported comments: open reports first (p_open_only: only those), each with the article,
-- the author, the text now and every report (who, why, when, and the text as it was reported:
-- body_snapshot, kept after an edit or a delete).
create function public.admin_resource_comment_reports(p_open_only boolean)
returns table (
  comment_id uuid,
  resource_id uuid,
  resource_slug text,
  resource_title text,
  body text,
  author_name text,
  author_org_name text,
  comment_created_at timestamptz,
  hidden boolean,
  deleted boolean,
  open_reports integer,
  total_reports integer,
  last_reported_at timestamptz,
  reports jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.resource_comment_staff();
  select c.id, r.id, r.slug, r.title, c.body,
         coalesce(nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''), 'A member'),
         ao.name,
         c.created_at,
         c.hidden_at is not null,
         c.deleted_at is not null,
         x.open_n, x.total_n, x.last_at, x.items
    from (select rp.comment_id as cid,
                 count(*) filter (where rp.resolved_at is null)::integer as open_n,
                 count(*)::integer as total_n,
                 max(rp.created_at) as last_at,
                 jsonb_agg(jsonb_build_object(
                   'reporter_name', coalesce(nullif(btrim(concat_ws(' ', pp.first_name, pp.last_name)), ''), 'A member'),
                   'reason', rp.reason, 'body_snapshot', rp.body_snapshot,
                   'created_at', rp.created_at, 'resolution', rp.resolution, 'resolved_at', rp.resolved_at)
                   order by rp.created_at desc) as items
            from public.resource_comment_report rp
            left join public.profiles pp on pp.user_id = rp.reporter_user_id
           group by rp.comment_id) x
    join public.resource_comment c on c.id = x.cid
    join public.resources r on r.id = c.resource_id
    left join public.profiles ap on ap.user_id = c.author_user_id
    left join public.organizations ao on ao.id = c.author_org_id
   where (not coalesce(p_open_only, true)) or x.open_n > 0
   order by (x.open_n > 0) desc, x.last_at desc
   limit 200;
$fn$;

-- ---- 6. The e-mail sender (service role only) ---------------------------------------------

-- Everything send-notification needs for one queued comment e-mail (notification_outbox id),
-- read from the database; {ok: false, stale: true, why} when the news is out of date.
create function public.resource_comment_email(p_outbox_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_o record;
  v_rep record;
  v_c record;
  v_r record;
  v_cid uuid;
  v_author text;
  v_author_org text;
  v_via text;
  v_reporter text;
  v_reason text;
  v_text text;
  v_open integer;
begin
  select o.id, o.kind, o.user_id, o.subject_id, o.sent_at into v_o from public.notification_outbox o where o.id = p_outbox_id;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'no such queued e-mail');
  end if;
  if v_o.kind not in ('comment_mention', 'comment_report') then
    return jsonb_build_object('ok', false, 'why', 'not a comment e-mail');
  end if;
  if v_o.sent_at is not null then
    return jsonb_build_object('ok', false, 'sent', true, 'why', 'already sent');
  end if;
  -- A switch turned off (an incident, or the e-mails not live yet) also stops what is queued.
  if not public.resource_comments_on() then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'comments are switched off');
  end if;
  if not public.resource_comment_emails_on() then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'comment e-mails are switched off');
  end if;
  if v_o.kind = 'comment_report' then
    select rp.id, rp.comment_id, rp.reporter_user_id, rp.reason, rp.body_snapshot, rp.resolved_at into v_rep
      from public.resource_comment_report rp where rp.id = v_o.subject_id;
    if not found then
      return jsonb_build_object('ok', false, 'stale', true, 'why', 'the report no longer exists');
    end if;
    if v_rep.resolved_at is not null then
      return jsonb_build_object('ok', false, 'stale', true, 'why', 'M3 already dealt with this report');
    end if;
    if not exists (select 1 from public.profiles p where p.user_id = v_o.user_id and p.access_status = 'verified'
                     and p.persona in ('admin', 'moderator')) then
      return jsonb_build_object('ok', false, 'stale', true, 'why', 'the recipient is no longer on the M3 team');
    end if;
    v_cid := v_rep.comment_id;
    v_reason := v_rep.reason;
    -- The text as it was reported (its author cannot have changed it since: no edit while a
    -- report is open; a delete closes the reports, and the e-mail with them).
    v_text := v_rep.body_snapshot;
  else
    v_cid := v_o.subject_id;
    if not exists (select 1 from public.resource_comment_notice n
                    where n.comment_id = v_cid and n.user_id = v_o.user_id and n.withdrawn_at is null) then
      return jsonb_build_object('ok', false, 'stale', true, 'why', 'the person is no longer tagged in this comment');
    end if;
    if not exists (select 1 from public.profiles p where p.user_id = v_o.user_id and p.access_status = 'verified') then
      return jsonb_build_object('ok', false, 'stale', true, 'why', 'the recipient is not a validated member any more');
    end if;
  end if;
  select rc.id, rc.body, rc.deleted_at, rc.hidden_at, rc.author_user_id, rc.author_org_id, rc.resource_id into v_c
    from public.resource_comment rc where rc.id = v_cid;
  if not found or v_c.deleted_at is not null then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'the comment was deleted');
  end if;
  if v_c.hidden_at is not null and v_o.kind = 'comment_mention' then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'M3 hid the comment');
  end if;
  if v_o.kind = 'comment_mention' then
    v_text := v_c.body;
  end if;
  select r.title, r.slug, r.published, r.access_level into v_r from public.resources r where r.id = v_c.resource_id;
  if not found or v_r.published is not true then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'the article is not published any more');
  end if;
  -- The article may have become members-only or marina-only since: nothing of it to someone who
  -- cannot open it (M3 staff always can).
  if not public.resource_comment_reader_ok(v_o.user_id, v_r.access_level) then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'the recipient may not read the article any more');
  end if;
  select nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') into v_author from public.profiles p where p.user_id = v_c.author_user_id;
  select o.name into v_author_org from public.organizations o
   where o.id = v_c.author_org_id and o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null;
  if v_o.kind = 'comment_mention' then
    select o.name into v_via from public.resource_comment_notice n join public.organizations o on o.id = n.via_org_id
     where n.comment_id = v_cid and n.user_id = v_o.user_id;
  else
    select nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') into v_reporter from public.profiles p where p.user_id = v_rep.reporter_user_id;
    select count(*)::integer into v_open from public.resource_comment_report rp where rp.comment_id = v_cid and rp.resolved_at is null;
  end if;
  return jsonb_build_object(
    'ok', true,
    'kind', v_o.kind,
    'user_id', v_o.user_id,
    'comment_id', v_cid,
    'resource_title', v_r.title,
    'resource_slug', v_r.slug,
    'author_name', coalesce(v_author, 'A member'),
    'author_org_name', v_author_org,
    'via_org_name', v_via,
    'excerpt', public.resource_comment_excerpt(v_text, 300),
    'hidden', v_c.hidden_at is not null,
    'reporter_name', case when v_o.kind = 'comment_report' then coalesce(v_reporter, 'A member') end,
    'reason', v_reason,
    'open_reports', v_open);
end
$fn$;

-- ---- 7. Who may call what ----------------------------------------------------------------

revoke all on function
  public.resource_comments_on(), public.resource_comment_emails_on(), public.resource_comment_gate(uuid, boolean), public.resource_comment_staff(),
  public.resource_comment_reader_ok(uuid, text), public.resource_comment_clean(text, integer), public.resource_comment_label(text),
  public.resource_comment_plain(text), public.resource_comment_excerpt(text, integer), public.resource_comment_prepare(text),
  public.resource_comment_recipients(uuid), public.resource_comment_notify(uuid),
  public.resource_comment_post(uuid, text), public.resource_comment_edit(uuid, text), public.resource_comment_delete(uuid),
  public.resource_comment_report(uuid, text), public.resource_comments_list(uuid), public.resource_comment_count(uuid),
  public.resource_comment_mention_search(text), public.resource_comment_my_notices(), public.resource_comment_mark_seen(bigint[]),
  public.admin_resource_comment_moderate(uuid, text, text), public.admin_resource_comment_reports(boolean),
  public.resource_comment_email(bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.resource_comment_count(uuid) to anon, authenticated, service_role;
grant execute on function
  public.resource_comment_post(uuid, text), public.resource_comment_edit(uuid, text), public.resource_comment_delete(uuid),
  public.resource_comment_report(uuid, text), public.resource_comments_list(uuid),
  public.resource_comment_mention_search(text), public.resource_comment_my_notices(), public.resource_comment_mark_seen(bigint[]),
  public.admin_resource_comment_moderate(uuid, text, text), public.admin_resource_comment_reports(boolean)
  to authenticated, service_role;
grant execute on function public.resource_comment_email(bigint) to service_role;

comment on function public.resource_comment_post(uuid, text) is
  'Post a comment under an article (validated members, switch article_comments on). Returns {id, emails}. 20261021130000.';
comment on function public.resource_comments_list(uuid) is
  'The comments of an article with authors and tags: validated members (switch on) and M3 staff. 20261021130000.';
comment on function public.resource_comment_count(uuid) is
  'Number of visible comments of an article, for everyone; null while the switch is off. 20261021130000.';
comment on function public.resource_comment_email(bigint) is
  'The words of one queued comment e-mail (comment_mention, comment_report), for send-notification. Service role only. 20261021130000.';

-- C. Checks after the migration
do $c$
declare
  v_fns regprocedure[] := array[
    'public.resource_comments_on()', 'public.resource_comment_emails_on()', 'public.resource_comment_gate(uuid,boolean)',
    'public.resource_comment_staff()',
    'public.resource_comment_reader_ok(uuid,text)', 'public.resource_comment_clean(text,integer)', 'public.resource_comment_label(text)',
    'public.resource_comment_plain(text)', 'public.resource_comment_excerpt(text,integer)', 'public.resource_comment_prepare(text)',
    'public.resource_comment_recipients(uuid)', 'public.resource_comment_notify(uuid)',
    'public.resource_comment_post(uuid,text)', 'public.resource_comment_edit(uuid,text)', 'public.resource_comment_delete(uuid)',
    'public.resource_comment_report(uuid,text)', 'public.resource_comments_list(uuid)', 'public.resource_comment_count(uuid)',
    'public.resource_comment_mention_search(text)', 'public.resource_comment_my_notices()', 'public.resource_comment_mark_seen(bigint[])',
    'public.admin_resource_comment_moderate(uuid,text,text)', 'public.admin_resource_comment_reports(boolean)',
    'public.resource_comment_email(bigint)']::regprocedure[];
  v_member regprocedure[] := array[
    'public.resource_comment_post(uuid,text)', 'public.resource_comment_edit(uuid,text)', 'public.resource_comment_delete(uuid)',
    'public.resource_comment_report(uuid,text)', 'public.resource_comments_list(uuid)',
    'public.resource_comment_mention_search(text)', 'public.resource_comment_my_notices()', 'public.resource_comment_mark_seen(bigint[])',
    'public.admin_resource_comment_moderate(uuid,text,text)', 'public.admin_resource_comment_reports(boolean)']::regprocedure[];
  v_pure regprocedure[] := array[
    'public.resource_comment_clean(text,integer)', 'public.resource_comment_label(text)',
    'public.resource_comment_plain(text)', 'public.resource_comment_excerpt(text,integer)']::regprocedure[];
  v_count regprocedure := 'public.resource_comment_count(uuid)'::regprocedure;
  v_email regprocedure := 'public.resource_comment_email(bigint)'::regprocedure;
  v_r uuid;
  v_rslug text;
  v_a uuid;
  v_a_name text;
  v_b uuid;
  v_b_label text;
  v_b_name text;
  v_d uuid;
  v_p uuid;
  v_s uuid;
  v_o uuid;
  v_oname text;
  v_uo uuid;
  v_owners uuid[];
  v_expected uuid[];
  v_ghost uuid := gen_random_uuid();
  v_c uuid;
  v_e uuid;
  v_c2 uuid;
  v_c3 uuid;
  v_x1 uuid;
  v_rep uuid;
  v_rep_e uuid;
  v_ob bigint;
  v_oo bigint;
  v_or bigint;
  v_od bigint;
  v_x record;
  v_y record;
  v_z record;
  v_nb1 text;
  v_np1 uuid[];
  v_no1 uuid[];
  v_nb2 text;
  v_np2 uuid[];
  v_j jsonb;
  v_k jsonb;
  v_txt text;
  v_body text;
  v_n bigint;
  v_m bigint;
  v_l bigint;
  v_q bigint;
  v_staff_n bigint;
  v_mine_hour bigint;
  v_succ integer := 0;
  v_last text;
  i integer;
begin
  -- C0 fixtures (read only): a public article, three validated members (A has a company; D is
  -- none of the others), a pending account, an M3 admin, a verified company with 1 to 3 validated
  -- owners (neither A nor B), and a company M3 has not validated
  select r.id, r.slug into v_r, v_rslug from public.resources r
   where r.published = true and lower(coalesce(nullif(btrim(r.access_level), ''), 'public')) = 'public'
   order by r.published_at desc nulls last, r.id limit 1;
  select p.user_id, coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'A member') into v_a, v_a_name
    from public.profiles p
   where p.access_status = 'verified' and p.persona not in ('admin', 'moderator')
     and btrim(concat_ws(' ', p.first_name, p.last_name)) <> ''
     and exists (select 1 from public.organization_members m where m.user_id = p.user_id)
   order by p.created_at, p.user_id limit 1;
  select p.user_id, public.resource_comment_label(concat_ws(' ', p.first_name, p.last_name)),
         coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'A member')
    into v_b, v_b_label, v_b_name
    from public.profiles p
   where p.access_status = 'verified' and p.persona not in ('admin', 'moderator')
     and public.resource_comment_label(concat_ws(' ', p.first_name, p.last_name)) <> '' and p.user_id <> v_a
   order by p.created_at desc, p.user_id limit 1;
  select p.user_id into v_p from public.profiles p where p.access_status = 'pending' order by p.created_at, p.user_id limit 1;
  select p.user_id into v_s from public.profiles p
   where p.access_status = 'verified' and p.persona = 'admin' and p.user_id <> v_a and p.user_id <> v_b
   order by p.created_at, p.user_id limit 1;
  select o.id, o.name into v_o, v_oname from public.organizations o
   where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null
     and public.resource_comment_label(o.name) <> ''
     and not exists (select 1 from public.organization_members m where m.organization_id = o.id and (m.user_id = v_a or m.user_id = v_b))
     and (select count(distinct m.user_id) from public.organization_members m
            join public.profiles p on p.user_id = m.user_id and p.access_status = 'verified'
           where m.organization_id = o.id and (m.role = 'owner' or o.owner_user_id = m.user_id)) between 1 and 3
   order by o.created_at, o.id limit 1;
  v_owners := array(select distinct m.user_id from public.organization_members m
                      join public.profiles p on p.user_id = m.user_id and p.access_status = 'verified'
                      join public.organizations o on o.id = m.organization_id
                     where m.organization_id = v_o and (m.role = 'owner' or o.owner_user_id = m.user_id)
                     order by m.user_id);
  v_expected := array(select distinct u from unnest(array[v_b] || v_owners) as t(u) order by u);
  select p.user_id into v_d from public.profiles p
   where p.access_status = 'verified' and p.persona not in ('admin', 'moderator')
     and public.resource_comment_label(concat_ws(' ', p.first_name, p.last_name)) <> ''
     and p.user_id <> v_a and p.user_id <> v_b and p.user_id is distinct from v_s and not (p.user_id = any(v_owners))
   order by p.created_at, p.user_id limit 1;
  select o.id into v_uo from public.organizations o
   where o.access_status is distinct from 'verified' and public.resource_comment_label(o.name) <> ''
   order by o.created_at, o.id limit 1;
  select count(*) into v_staff_n from public.profiles p
   where p.persona in ('admin', 'moderator') and p.access_status = 'verified' and p.user_id <> v_b;
  insert into _dr_res (ok, label) values (
    v_r is not null and v_rslug is not null and v_a is not null and v_b is not null and v_d is not null and v_p is not null
      and v_s is not null and v_o is not null and v_uo is not null and cardinality(v_owners) between 1 and 3 and v_staff_n > 0,
    'C0 fixtures: a public article, members A, B and D, a pending account, an admin, a company with '
      || coalesce(cardinality(v_owners), 0) || ' owner(s), a company not validated, ' || v_staff_n || ' staff to e-mail');

  -- C1 tables
  insert into _dr_res (ok, label) values (
    (select count(*) from pg_class c
      where c.oid in ('public.resource_comment'::regclass, 'public.resource_comment_mention'::regclass,
                      'public.resource_comment_report'::regclass, 'public.resource_comment_notice'::regclass)
        and c.relrowsecurity) = 4
      and not exists (select 1 from pg_policies pp where pp.schemaname = 'public'
                       and pp.tablename in ('resource_comment', 'resource_comment_mention', 'resource_comment_report', 'resource_comment_notice'))
      and not exists (select 1
                        from unnest(array['public.resource_comment', 'public.resource_comment_mention',
                                          'public.resource_comment_report', 'public.resource_comment_notice']) as t(tn)
                        cross join unnest(array['anon', 'authenticated']) as g(rn)
                        cross join unnest(array['select', 'insert', 'update', 'delete']) as pv(pn)
                       where has_table_privilege(g.rn, t.tn, pv.pn))
      and has_table_privilege('service_role', 'public.resource_comment', 'select')
      and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = 'resource_comment_report'
                   and ic.column_name = 'body_snapshot' and ic.is_nullable = 'NO')
      and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = 'resource_comment_notice'
                   and ic.column_name = 'withdrawn_at'),
    'C1 four tables, RLS on, no policy, no table privilege for anon or authenticated (the functions only); report body_snapshot, notice withdrawn_at');

  -- C2 functions: 24, definer except the 4 pure text helpers, search_path '', owned by the migrating role
  select count(*), count(*) filter (where p.prosecdef = not (p.oid = any(v_pure))),
         count(*) filter (where array_to_string(p.proconfig, ';') = 'search_path=""'),
         count(*) filter (where p.proowner = (select r.oid from pg_roles r where r.rolname = current_user))
    into v_n, v_m, v_l, v_q
    from pg_proc p where p.oid = any(v_fns);
  insert into _dr_res (ok, label) values (v_n = 24 and v_m = 24 and v_l = 24 and v_q = 24,
    'C2 24 functions: SECURITY DEFINER but the 4 text helpers (' || v_m || '), search_path empty (' || v_l || '), owner ' || current_user || ' (' || v_q || ')');

  -- C3 who may execute: anon the count only; authenticated the 10 member/staff ones + the count;
  -- service_role those + the e-mail payload; PUBLIC nothing
  insert into _dr_res (ok, label) values (
    not exists (select 1 from unnest(v_fns) as f(o) where has_function_privilege('anon', f.o, 'execute') <> (f.o = v_count))
      and not exists (select 1 from unnest(v_fns) as f(o)
                       where has_function_privilege('authenticated', f.o, 'execute') <> (f.o = any(v_member) or f.o = v_count))
      and not exists (select 1 from unnest(v_fns) as f(o)
                       where has_function_privilege('service_role', f.o, 'execute') <> (f.o = any(v_member) or f.o = v_count or f.o = v_email))
      and not exists (select 1 from unnest(v_fns) as f(o)
                       cross join lateral aclexplode((select p.proacl from pg_proc p where p.oid = f.o)) a
                      where a.grantee = 0)
      and not exists (select 1 from unnest(v_fns) as f(o) join pg_proc p on p.oid = f.o where p.proacl is null),
    'C3 EXECUTE: anon count only; authenticated 10 + count; service_role those + resource_comment_email; no PUBLIC grant');

  -- C4 the outbox takes the two comment kinds, the eight of Phase 3 unchanged
  insert into _dr_res (ok, label) values (
    (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass)
      = 'CHECK ((kind = ANY (ARRAY[''account_under_review''::text, ''team_join_request''::text, ''user_account_approved''::text, ''user_account_rejected''::text, ''account_info_requested''::text, ''company_validated''::text, ''claim_approved''::text, ''claim_declined''::text, ''comment_mention''::text, ''comment_report''::text])))',
    'C4 notification_outbox kinds: the 8 of Phase 3 + comment_mention, comment_report');

  -- Both switches OFF (as in production until the preview tries comments)
  update public.platform_settings ps set value = ps.value - 'article_comments' - 'article_comment_emails' where ps.key = 'registration_flags';

  -- C5 switch off: a visitor's count is null (nothing shows)
  select * into v_x from pg_temp._dr_as('anon', null, format('select public.resource_comment_count(%L)', v_r));
  insert into _dr_res (ok, label) values (v_x.ok and v_x.val is null,
    'C5 switch off: anon count -> ' || case when v_x.ok then coalesce(v_x.val, 'null') else v_x.state || ' ' || v_x.msg end);

  -- C6 switch off: a validated member cannot post
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', v_r, 'Hello'));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.state = 'P0001' and v_x.msg = 'comments_off',
    'C6 switch off: member post -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok ' || coalesce(v_x.val, '')));

  -- C7 switch off: M3 staff still read (moderation)
  select * into v_x from pg_temp._dr_as('authenticated', v_s, format('select count(*) from public.resource_comments_list(%L)', v_r));
  insert into _dr_res (ok, label) values (v_x.ok and v_x.val = '0',
    'C7 switch off: staff list -> ' || case when v_x.ok then 'ok ' || v_x.val || ' row(s)' else v_x.state || ' ' || v_x.msg end);

  -- The comments ON, their e-mails still OFF (the preview before go-live)
  update public.platform_settings ps set value = ps.value || '{"article_comments": true}'::jsonb where ps.key = 'registration_flags';

  -- C8 visitor: the count only
  select * into v_x from pg_temp._dr_as('anon', null, format('select public.resource_comment_count(%L)', v_r));
  insert into _dr_res (ok, label) values (v_x.ok and v_x.val = '0',
    'C8 anon count -> ' || case when v_x.ok then coalesce(v_x.val, 'null') else v_x.state || ' ' || v_x.msg end);

  -- C9 visitor cannot call the member functions at all
  select * into v_x from pg_temp._dr_as('anon', null, format('select public.resource_comment_post(%L, %L)::text', v_r, 'Hello'));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.state = '42501',
    'C9 anon post -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C10 pending account cannot post
  select * into v_x from pg_temp._dr_as('authenticated', v_p, format('select public.resource_comment_post(%L, %L)::text', v_r, 'Hello'));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.state = '42501' and v_x.msg = 'comment_not_validated',
    'C10 pending account post -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C11 pending account cannot read the names either
  select * into v_x from pg_temp._dr_as('authenticated', v_p, format('select count(*) from public.resource_comments_list(%L)', v_r));
  select * into v_y from pg_temp._dr_as('authenticated', v_p, format('select count(*) from public.resource_comment_mention_search(%L)', 'ma'));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_not_validated' and not v_y.ok and v_y.msg = 'comment_not_validated',
    'C11 pending account list / tag search -> ' || coalesce(v_x.msg, 'ok') || ' / ' || coalesce(v_y.msg, 'ok'));

  -- C12 pending account sees the count
  select * into v_x from pg_temp._dr_as('authenticated', v_p, format('select public.resource_comment_count(%L)', v_r));
  insert into _dr_res (ok, label) values (v_x.ok and v_x.val = '0',
    'C12 pending account count -> ' || case when v_x.ok then coalesce(v_x.val, 'null') else v_x.state || ' ' || v_x.msg end);

  -- C13 an article that does not exist
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', gen_random_uuid(), 'Hello'));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_article_unavailable',
    'C13 post under an unknown article -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C14 empty text
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', v_r, '   '));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_empty',
    'C14 empty comment -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C15 2001 characters
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', v_r, repeat('a', 2001)));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_too_long',
    'C15 2001 characters -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C16 six tags
  select string_agg('@[x](org:' || o.id::text || ')', ' ') into v_body
    from (select o.id from public.organizations o
           where o.access_status = 'verified' and o.archived_at is null and o.duplicate_of is null
             and public.resource_comment_label(o.name) <> ''
           order by o.id limit 6) o;
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', v_r, 'Six: ' || v_body));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_too_many_tags',
    'C16 six tags -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C17 e-mails off: A tags D; D is told on the site, nothing is queued
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', v_r,
    'E-mails off, a dry run: @[D](user:' || v_d::text || ')'));
  if v_x.ok then
    v_e := (v_x.val::jsonb ->> 'id')::uuid;
  end if;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and v_e is not null and (v_x.val::jsonb ->> 'emails') = '0'
      and exists (select 1 from public.resource_comment_notice n where n.comment_id = v_e and n.user_id = v_d and n.withdrawn_at is null)
      and not exists (select 1 from public.notification_outbox o where o.subject_id = v_e), false),
    'C17 e-mails off: A tags D -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg) || ', notice for D, no queued e-mail');

  -- C18 e-mails off: B reports it; the report keeps the text, no e-mail to M3 is queued
  select * into v_x from pg_temp._dr_as('authenticated', v_b, format('select public.resource_comment_report(%L, %L)::text', v_e, 'Dry run, e-mails off'));
  v_j := case when v_x.ok then v_x.val::jsonb end;
  v_rep_e := (v_j ->> 'report_id')::uuid;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and v_rep_e is not null and (v_j ->> 'emails') = '0' and (v_j ->> 'already') = 'false'
      and (select rp.body_snapshot from public.resource_comment_report rp where rp.id = v_rep_e)
          = (select c.body from public.resource_comment c where c.id = v_e)
      and not exists (select 1 from public.notification_outbox o where o.kind = 'comment_report' and o.subject_id = v_rep_e), false),
    'C18 e-mails off: B reports -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg) || ', text kept, no e-mail queued');

  -- C19 A deletes the reported comment: text erased, report closed with its copy, D's notice
  -- withdrawn (kept for the daily limit) and gone from D's dashboard
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_delete(%L)::text', v_e));
  select * into v_y from pg_temp._dr_as('authenticated', v_d, 'select count(*) from public.resource_comment_my_notices()');
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and v_y.ok and v_y.val = '0'
      and (select c.body = '' and c.deleted_at is not null from public.resource_comment c where c.id = v_e)
      and (select rp.resolution = 'deleted' and rp.body_snapshot like 'E-mails off, a dry run: @[%' from public.resource_comment_report rp where rp.id = v_rep_e)
      and exists (select 1 from public.resource_comment_notice n where n.comment_id = v_e and n.user_id = v_d and n.withdrawn_at is not null), false),
    'C19 A deletes the reported comment -> ' || coalesce(v_x.val, v_x.msg) || '; D''s notices ' || coalesce(v_y.val, v_y.msg) || ', report keeps its copy');

  -- The e-mails ON from here (go-live)
  update public.platform_settings ps set value = ps.value || '{"article_comment_emails": true}'::jsonb where ps.key = 'registration_flags';

  -- C20 A posts, tagging B under a wrong name, the company, someone who does not exist, the
  -- pending account and a company M3 has not validated
  v_body := 'Hello @[Wrong Name](user:' || v_b::text || ') and @[x](org:' || v_o::text || ') and @[ghost](user:' || v_ghost::text
    || ') and @[Pending Person](user:' || v_p::text || ') and @[Unlisted Co](org:' || v_uo::text || ') - a dry run.';
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', v_r, v_body));
  if v_x.ok then
    v_j := v_x.val::jsonb;
    v_c := (v_j ->> 'id')::uuid;
  end if;
  insert into _dr_res (ok, label) values (v_x.ok and v_c is not null and (v_j ->> 'emails')::integer = cardinality(v_expected),
    'C20 A posts with 5 tags -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg) || ' (expected ' || cardinality(v_expected) || ' e-mail(s))');

  -- C21 the stored text: B under B's real name, the company under its name, the three others plain text
  select c.body into v_txt from public.resource_comment c where c.id = v_c;
  insert into _dr_res (ok, label) values (
    coalesce(position('@[' || v_b_label || '](user:' || v_b::text || ')' in v_txt) > 0
      and position('@[' || public.resource_comment_label(v_oname) || '](org:' || v_o::text || ')' in v_txt) > 0
      and position('@ghost' in v_txt) > 0 and position('@Pending Person' in v_txt) > 0 and position('@Unlisted Co' in v_txt) > 0
      and position('Wrong Name' in v_txt) = 0
      and position(v_ghost::text in v_txt) = 0 and position(v_p::text in v_txt) = 0 and position(v_uo::text in v_txt) = 0, false),
    'C21 tags rewritten from the database; unknown person, pending account and unvalidated company left as plain text');

  -- C22 two tag rows (none for the pending account or the unvalidated company); the author's company snapshot
  insert into _dr_res (ok, label) values (
    (select count(*) from public.resource_comment_mention m where m.comment_id = v_c) = 2
      and exists (select 1 from public.resource_comment_mention m where m.comment_id = v_c and m.mentioned_user_id = v_b)
      and exists (select 1 from public.resource_comment_mention m where m.comment_id = v_c and m.mentioned_org_id = v_o)
      and (select c.author_org_id from public.resource_comment c where c.id = v_c) is not distinct from public.partner_request_user_org(v_a, null),
    'C22 tags stored: B and the company only; author company = partner_request_user_org(A)');

  -- C23 notices and queued e-mails: B (by name) and the company's owners (through it), never A,
  -- nor the pending account
  insert into _dr_res (ok, label) values (
    array(select n.user_id from public.resource_comment_notice n where n.comment_id = v_c order by n.user_id) = v_expected
      and (select n.via_org_id from public.resource_comment_notice n where n.comment_id = v_c and n.user_id = v_b) is null
      and not exists (select 1 from public.resource_comment_notice n where n.comment_id = v_c and n.user_id <> v_b and n.via_org_id is distinct from v_o)
      and not exists (select 1 from public.resource_comment_notice n where n.comment_id = v_c and (n.user_id = v_a or n.user_id = v_p))
      and array(select o.user_id from public.notification_outbox o where o.kind = 'comment_mention' and o.subject_id = v_c order by o.user_id) = v_expected
      and not exists (select 1 from public.notification_outbox o where o.kind = 'comment_mention' and o.subject_id = v_c
                       and (o.dedupe_key <> 'comment_mention:' || v_c::text || ':' || o.user_id::text or o.actor_id is distinct from v_a or o.sent_at is not null)),
    'C23 ' || cardinality(v_expected) || ' notice(s) and queued e-mail(s): B by name, the company''s owners through it, not the author');

  -- C24 B reads the comment: author's name, not the author's id, 2 tags, B's notice
  select * into v_x from pg_temp._dr_as('authenticated', v_b,
    format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb)::text from public.resource_comments_list(%L) x', v_r));
  v_j := case when v_x.ok then v_x.val::jsonb end;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and jsonb_array_length(v_j) = 1 and (v_j -> 0 ->> 'id')::uuid = v_c
      and (v_j -> 0 ->> 'is_mine') = 'false' and (v_j -> 0 ->> 'author_user_id') is null
      and (v_j -> 0 ->> 'author_name') = v_a_name and jsonb_array_length(v_j -> 0 -> 'mentions') = 2
      and (v_j -> 0 ->> 'my_notice_id') is not null and (v_j -> 0 ->> 'open_reports') is null, false),
    'C24 B lists the comments -> ' || coalesce(v_x.msg, coalesce(jsonb_array_length(v_j), 0) || ' row(s)'));

  -- C25 B's dashboard notice
  select * into v_x from pg_temp._dr_as('authenticated', v_b,
    'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb)::text from public.resource_comment_my_notices() x');
  v_j := case when v_x.ok then v_x.val::jsonb end;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and jsonb_array_length(v_j) = 1 and (v_j -> 0 ->> 'comment_id')::uuid = v_c
      and (v_j -> 0 ->> 'resource_slug') = v_rslug and (v_j -> 0 ->> 'excerpt') like 'Hello @%'
      and (v_j -> 0 ->> 'via_org_name') is null, false),
    'C25 B''s notices -> ' || coalesce(v_x.msg, coalesce(jsonb_array_length(v_j), 0) || ' row(s)'));

  -- C26 the e-mail to B, from the database
  select o.id into v_ob from public.notification_outbox o where o.kind = 'comment_mention' and o.subject_id = v_c and o.user_id = v_b;
  v_j := public.resource_comment_email(v_ob);
  insert into _dr_res (ok, label) values (
    coalesce((v_j ->> 'ok') = 'true' and (v_j ->> 'kind') = 'comment_mention' and (v_j ->> 'resource_slug') = v_rslug
      and (v_j ->> 'author_name') = v_a_name and (v_j ->> 'via_org_name') is null and (v_j ->> 'comment_id')::uuid = v_c
      and (v_j ->> 'excerpt') like 'Hello @%', false),
    'C26 resource_comment_email(B''s row) -> ok ' || coalesce(v_j ->> 'ok', 'null'));

  -- C27 the e-mail to an owner names the company
  select o.id into v_oo from public.notification_outbox o where o.kind = 'comment_mention' and o.subject_id = v_c and o.user_id = v_owners[1];
  v_j := public.resource_comment_email(v_oo);
  insert into _dr_res (ok, label) values (coalesce((v_j ->> 'ok') = 'true' and (v_j ->> 'via_org_name') = v_oname, false),
    'C27 resource_comment_email(an owner''s row) names the company -> ' || coalesce(v_j ->> 'via_org_name', 'null'));

  -- C28 either switch off: what is queued is out of date (not sent); both on again: it goes
  update public.platform_settings ps set value = ps.value || '{"article_comment_emails": false}'::jsonb where ps.key = 'registration_flags';
  v_j := public.resource_comment_email(v_ob);
  update public.platform_settings ps set value = ps.value || '{"article_comment_emails": true, "article_comments": false}'::jsonb where ps.key = 'registration_flags';
  v_k := public.resource_comment_email(v_ob);
  update public.platform_settings ps set value = ps.value || '{"article_comments": true}'::jsonb where ps.key = 'registration_flags';
  insert into _dr_res (ok, label) values (
    coalesce((v_j ->> 'stale') = 'true' and (v_j ->> 'why') = 'comment e-mails are switched off'
      and (v_k ->> 'stale') = 'true' and (v_k ->> 'why') = 'comments are switched off'
      and (public.resource_comment_email(v_ob) ->> 'ok') = 'true', false),
    'C28 e-mails switch off -> ' || coalesce(v_j ->> 'why', 'null') || '; comments switch off -> ' || coalesce(v_k ->> 'why', 'null') || '; both on -> sent');

  -- C29 B marks the notice seen
  select * into v_x from pg_temp._dr_as('authenticated', v_b, 'select public.resource_comment_mark_seen(null)');
  select * into v_y from pg_temp._dr_as('authenticated', v_b, 'select count(*) from public.resource_comment_my_notices()');
  insert into _dr_res (ok, label) values (v_x.ok and v_x.val = '1' and v_y.ok and v_y.val = '0',
    'C29 B marks seen -> ' || coalesce(v_x.val, v_x.msg) || ', notices left ' || coalesce(v_y.val, v_y.msg));

  -- C30 B cannot edit A's comment
  select * into v_x from pg_temp._dr_as('authenticated', v_b, format('select public.resource_comment_edit(%L, %L)::text', v_c, 'Changed'));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.state = '42501' and v_x.msg = 'comment_not_yours',
    'C30 B edits A''s comment -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C31 A removes B's tag: B's tag goes, B's notice is withdrawn (kept), the owners keep theirs, "edited"
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_edit(%L, %L)::text', v_c,
    'Hello and @[x](org:' || v_o::text || ') - edited.'));
  v_j := case when v_x.ok then v_x.val::jsonb end;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and (v_j ->> 'changed') = 'true' and (v_j ->> 'emails') = '0'
      and not exists (select 1 from public.resource_comment_mention m where m.comment_id = v_c and m.mentioned_user_id = v_b)
      and exists (select 1 from public.resource_comment_notice n where n.comment_id = v_c and n.user_id = v_b and n.withdrawn_at is not null)
      and array(select n.user_id from public.resource_comment_notice n where n.comment_id = v_c and n.withdrawn_at is null order by n.user_id)
          = array(select u from unnest(v_owners) as t(u) where u <> v_b order by u)
      and (select c.edited_at from public.resource_comment c where c.id = v_c) is not null, false),
    'C31 A edits out B -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg));

  -- C32 the queued e-mail to B is now out of date
  v_j := public.resource_comment_email(v_ob);
  insert into _dr_res (ok, label) values (
    coalesce((v_j ->> 'ok') = 'false' and (v_j ->> 'stale') = 'true' and (v_j ->> 'why') = 'the person is no longer tagged in this comment', false),
    'C32 resource_comment_email(B''s row) after the edit -> ' || coalesce(v_j ->> 'why', 'null'));

  -- C33 A tags B again: B's notice comes back as it was (seen), no second e-mail
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_edit(%L, %L)::text', v_c,
    'Hello @[Someone](user:' || v_b::text || ') and @[x](org:' || v_o::text || ') - edited again.'));
  v_j := case when v_x.ok then v_x.val::jsonb end;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and (v_j ->> 'changed') = 'true' and (v_j ->> 'emails') = '0'
      and exists (select 1 from public.resource_comment_notice n where n.comment_id = v_c and n.user_id = v_b
                   and n.withdrawn_at is null and n.seen_at is not null)
      and (select count(*) from public.resource_comment_notice n where n.comment_id = v_c and n.user_id = v_b) = 1
      and (select count(*) from public.notification_outbox o where o.kind = 'comment_mention' and o.subject_id = v_c and o.user_id = v_b) = 1, false),
    'C33 A tags B again -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg));

  -- C34 B reports the comment: one e-mail queued per M3 staff member; the text is kept
  select * into v_x from pg_temp._dr_as('authenticated', v_b, format('select public.resource_comment_report(%L, %L)::text', v_c,
    'Dry run: not appropriate'));
  v_j := case when v_x.ok then v_x.val::jsonb end;
  v_rep := (v_j ->> 'report_id')::uuid;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and v_rep is not null and (v_j ->> 'already') = 'false' and (v_j ->> 'emails')::bigint = v_staff_n
      and (select count(*) from public.notification_outbox o where o.kind = 'comment_report' and o.subject_id = v_rep and o.actor_id = v_b) = v_staff_n
      and (select rp.reason from public.resource_comment_report rp where rp.id = v_rep) = 'Dry run: not appropriate'
      and (select rp.body_snapshot from public.resource_comment_report rp where rp.id = v_rep)
          = (select c.body from public.resource_comment c where c.id = v_c), false),
    'C34 B reports -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg) || ' (expected ' || v_staff_n || ' e-mail(s)), text kept');

  -- C35 a second report by B changes nothing
  select * into v_x from pg_temp._dr_as('authenticated', v_b, format('select public.resource_comment_report(%L, %L)::text', v_c, 'Again'));
  v_j := case when v_x.ok then v_x.val::jsonb end;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and (v_j ->> 'already') = 'true' and (v_j ->> 'emails') = '0'
      and (select count(*) from public.resource_comment_report rp where rp.comment_id = v_c) = 1, false),
    'C35 B reports again -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg));

  -- C36 A cannot report their own comment
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_report(%L, null)::text', v_c));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_report_own',
    'C36 A reports own comment -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C37 while the report is open, A cannot change the text M3 is judging
  select c.body into v_txt from public.resource_comment c where c.id = v_c;
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_edit(%L, %L)::text', v_c, 'All fine, nothing to see.'));
  insert into _dr_res (ok, label) values (
    not v_x.ok and v_x.msg = 'comment_under_review' and (select c.body from public.resource_comment c where c.id = v_c) = v_txt,
    'C37 A edits a reported comment -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C38 the e-mail to the M3 team, with the text as reported
  select o.id into v_or from public.notification_outbox o where o.kind = 'comment_report' and o.subject_id = v_rep order by o.id limit 1;
  v_j := public.resource_comment_email(v_or);
  insert into _dr_res (ok, label) values (
    coalesce((v_j ->> 'ok') = 'true' and (v_j ->> 'kind') = 'comment_report' and (v_j ->> 'reporter_name') = v_b_name
      and (v_j ->> 'reason') = 'Dry run: not appropriate' and (v_j ->> 'open_reports') = '1' and (v_j ->> 'comment_id')::uuid = v_c
      and (v_j ->> 'excerpt') like 'Hello @%', false),
    'C38 resource_comment_email(a report row) -> ok ' || coalesce(v_j ->> 'ok', 'null'));

  -- C39 staff see the open report and the author's id
  select * into v_x from pg_temp._dr_as('authenticated', v_s,
    format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb)::text from public.resource_comments_list(%L) x', v_r));
  v_j := case when v_x.ok then v_x.val::jsonb end;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and jsonb_array_length(v_j) = 1 and (v_j -> 0 ->> 'open_reports') = '1' and (v_j -> 0 ->> 'author_user_id')::uuid = v_a, false),
    'C39 staff list -> ' || coalesce(v_x.msg, coalesce(jsonb_array_length(v_j), 0) || ' row(s)'));

  -- C40 the staff list of reports, with the text as reported
  select * into v_x from pg_temp._dr_as('authenticated', v_s,
    'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb)::text from public.admin_resource_comment_reports(true) x');
  v_j := case when v_x.ok then v_x.val::jsonb end;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and jsonb_array_length(v_j) = 1 and (v_j -> 0 ->> 'comment_id')::uuid = v_c
      and (v_j -> 0 ->> 'open_reports') = '1' and jsonb_array_length(v_j -> 0 -> 'reports') = 1
      and (v_j -> 0 -> 'reports' -> 0 ->> 'reporter_name') = v_b_name
      and (v_j -> 0 -> 'reports' -> 0 ->> 'body_snapshot') = v_txt, false),
    'C40 admin_resource_comment_reports(true) -> ' || coalesce(v_x.msg, coalesce(jsonb_array_length(v_j), 0) || ' row(s)'));

  -- C41 a member is not staff
  select * into v_x from pg_temp._dr_as('authenticated', v_b, 'select count(*) from public.admin_resource_comment_reports(true)');
  select * into v_y from pg_temp._dr_as('authenticated', v_b, format('select public.admin_resource_comment_moderate(%L, %L, null)::text', v_c, 'hide'));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_not_staff' and not v_y.ok and v_y.msg = 'comment_not_staff',
    'C41 B on the staff functions -> ' || coalesce(v_x.msg, 'ok') || ' / ' || coalesce(v_y.msg, 'ok'));

  -- C42 an unknown action
  select * into v_x from pg_temp._dr_as('authenticated', v_s, format('select public.admin_resource_comment_moderate(%L, %L, null)::text', v_c, 'erase'));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_bad_action',
    'C42 staff action "erase" -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C43 staff hide it: the report closes, the e-mails still queued for it are settled unsent
  select * into v_x from pg_temp._dr_as('authenticated', v_s, format('select public.admin_resource_comment_moderate(%L, %L, %L)::text', v_c, 'hide', 'Dry run reason'));
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and v_x.val = 'true'
      and (select c.hidden_by from public.resource_comment c where c.id = v_c) = v_s
      and (select rp.resolution || '/' || coalesce(rp.resolved_by::text, '') from public.resource_comment_report rp where rp.id = v_rep) = 'hidden/' || v_s::text
      and not exists (select 1 from public.notification_outbox o
                       where o.sent_at is null and ((o.kind = 'comment_mention' and o.subject_id = v_c) or (o.kind = 'comment_report' and o.subject_id = v_rep)))
      and not exists (select 1 from public.notification_outbox o
                       where ((o.kind = 'comment_mention' and o.subject_id = v_c) or (o.kind = 'comment_report' and o.subject_id = v_rep))
                         and o.last_error not like 'not sent: %'), false),
    'C43 staff hide -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg));

  -- C44 hidden: gone for B, the count and an owner's dashboard; still there for its author, marked hidden with the reason
  select * into v_x from pg_temp._dr_as('authenticated', v_b, format('select count(*) from public.resource_comments_list(%L)', v_r));
  select * into v_y from pg_temp._dr_as('anon', null, format('select public.resource_comment_count(%L)', v_r));
  select * into v_z from pg_temp._dr_as('authenticated', v_owners[1], 'select count(*) from public.resource_comment_my_notices()');
  v_k := (select to_jsonb(z) from (select * from pg_temp._dr_as('authenticated', v_a,
           format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb)::text from public.resource_comments_list(%L) x', v_r))) z);
  v_j := case when (v_k ->> 'ok') = 'true' then (v_k ->> 'val')::jsonb end;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and v_x.val = '0' and v_y.ok and v_y.val = '0' and v_z.ok and v_z.val = '0' and jsonb_array_length(v_j) = 1
      and (v_j -> 0 ->> 'hidden') = 'true' and (v_j -> 0 ->> 'hidden_reason') = 'Dry run reason' and (v_j -> 0 ->> 'is_mine') = 'true', false),
    'C44 hidden: B sees ' || coalesce(v_x.val, v_x.msg) || ', count ' || coalesce(v_y.val, v_y.msg) || ', owner''s notices '
      || coalesce(v_z.val, v_z.msg) || ', its author sees it marked hidden');

  -- C45 a hidden comment can be neither edited nor reported
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_edit(%L, %L)::text', v_c, 'Changed'));
  select * into v_y from pg_temp._dr_as('authenticated', v_s, format('select public.resource_comment_report(%L, null)::text', v_c));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_hidden' and not v_y.ok and v_y.msg = 'comment_not_found',
    'C45 edit / report a hidden comment -> ' || coalesce(v_x.msg, 'ok') || ' / ' || coalesce(v_y.msg, 'ok'));

  -- C46 staff show it again: back for B and on the owner's dashboard
  select * into v_x from pg_temp._dr_as('authenticated', v_s, format('select public.admin_resource_comment_moderate(%L, %L, null)::text', v_c, 'unhide'));
  select * into v_y from pg_temp._dr_as('authenticated', v_b, format('select count(*) from public.resource_comments_list(%L)', v_r));
  select * into v_z from pg_temp._dr_as('authenticated', v_owners[1], 'select count(*) from public.resource_comment_my_notices()');
  insert into _dr_res (ok, label) values (v_x.ok and v_x.val = 'true' and v_y.ok and v_y.val = '1' and v_z.ok and v_z.val = '1'
      and (select c.hidden_at is null and c.hidden_reason is null from public.resource_comment c where c.id = v_c),
    'C46 staff unhide -> B sees ' || coalesce(v_y.val, v_y.msg) || ', owner''s notices ' || coalesce(v_z.val, v_z.msg));

  -- C47 A deletes it: text erased, tags gone, notices withdrawn (kept), the report keeps its copy, nobody sees it
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_delete(%L)::text', v_c));
  select * into v_y from pg_temp._dr_as('authenticated', v_b, format('select count(*) from public.resource_comments_list(%L)', v_r));
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and v_x.val = 'true' and v_y.ok and v_y.val = '0'
      and (select c.body = '' and c.deleted_at is not null from public.resource_comment c where c.id = v_c)
      and not exists (select 1 from public.resource_comment_mention m where m.comment_id = v_c)
      and (select count(*) from public.resource_comment_notice n where n.comment_id = v_c) = cardinality(v_expected)
      and not exists (select 1 from public.resource_comment_notice n where n.comment_id = v_c and n.withdrawn_at is null)
      and (select rp.body_snapshot from public.resource_comment_report rp where rp.id = v_rep) = v_txt
      and public.resource_comment_count(v_r) = 0, false),
    'C47 A deletes -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg) || ', B sees ' || coalesce(v_y.val, v_y.msg));

  -- C48 deleting twice
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_delete(%L)::text', v_c));
  insert into _dr_res (ok, label) values (not v_x.ok and v_x.msg = 'comment_not_found',
    'C48 delete again -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C49 a deleted comment's e-mail still queued is settled unsent: A tags D (never e-mailed by A), deletes at once
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', v_r,
    'Dry run, deleted at once: @[D](user:' || v_d::text || ')'));
  v_c2 := case when v_x.ok then (v_x.val::jsonb ->> 'id')::uuid end;
  select o.id into v_od from public.notification_outbox o where o.kind = 'comment_mention' and o.subject_id = v_c2 and o.user_id = v_d;
  select * into v_y from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_delete(%L)::text', v_c2));
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and (v_x.val::jsonb ->> 'emails') = '1' and v_od is not null and v_y.ok
      and (select o.sent_at is not null and o.last_error = 'not sent: the comment was deleted' from public.notification_outbox o where o.id = v_od), false),
    'C49 tag then delete -> ' || coalesce(v_x.val, v_x.msg) || '; queued e-mail ' || coalesce((select o.last_error from public.notification_outbox o where o.id = v_od), 'missing'));

  -- C50 a tag by the same author within 24 hours: told on the site, no second e-mail (B had one from A in C20)
  select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', v_r,
    'Dry run, B again: @[B](user:' || v_b::text || ')'));
  v_c3 := case when v_x.ok then (v_x.val::jsonb ->> 'id')::uuid end;
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and (v_x.val::jsonb ->> 'emails') = '0'
      and exists (select 1 from public.resource_comment_notice n where n.comment_id = v_c3 and n.user_id = v_b and n.seen_at is null and n.withdrawn_at is null)
      and not exists (select 1 from public.notification_outbox o where o.subject_id = v_c3), false),
    'C50 A tags B again in a new comment -> ' || coalesce(v_x.val, v_x.state || ' ' || v_x.msg) || ' (notice, no e-mail)');

  -- C51 a tag hidden inside another is checked too: around a bad tag, a tag of the pending
  -- account becomes plain text; around one of B, B under B's name; deeper nesting is refused
  begin
    select pr.o_body, pr.o_people, pr.o_orgs into v_nb1, v_np1, v_no1
      from public.resource_comment_prepare('Nested @[@[Z](user:' || v_ghost::text || ')](user:' || v_p::text || ') end') pr;
    select pr.o_body, pr.o_people into v_nb2, v_np2
      from public.resource_comment_prepare('Nested @[@[Z](user:' || v_ghost::text || ')](user:' || v_b::text || ') end') pr;
  exception when others then
    v_nb1 := 'error: ' || sqlerrm;
  end;
  begin
    perform public.resource_comment_prepare('Deep @[@[@[Z](user:' || v_ghost::text || ')](user:' || v_ghost::text || ')](user:' || v_b::text || ')');
    v_last := 'accepted';
  exception when others then
    v_last := sqlerrm;
  end;
  insert into _dr_res (ok, label) values (
    coalesce(v_nb1 = 'Nested @@Z end' and cardinality(v_np1) = 0 and cardinality(v_no1) = 0
      and v_nb2 = 'Nested @[' || v_b_label || '](user:' || v_b::text || ') end' and v_np2 = array[v_b]
      and v_last = 'comment_bad_tag', false),
    'C51 nested tags -> ' || coalesce(v_nb1, 'null') || ' / around B: ' || coalesce(cardinality(v_np2)::text, 'null') || ' tag / deeper: ' || coalesce(v_last, 'null'));
  v_last := null;

  -- C52 tag suggestions: the company by its name; never the caller; nothing under 2 characters
  select * into v_x from pg_temp._dr_as('authenticated', v_a,
    format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb)::text from public.resource_comment_mention_search(%L) x', v_oname));
  v_j := case when v_x.ok then v_x.val::jsonb end;
  v_k := (select to_jsonb(z) from (select * from pg_temp._dr_as('authenticated', v_a,
           format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb)::text from public.resource_comment_mention_search(%L) x', v_a_name))) z);
  select * into v_y from pg_temp._dr_as('authenticated', v_a, format('select count(*) from public.resource_comment_mention_search(%L)', 'm'));
  insert into _dr_res (ok, label) values (
    coalesce(v_x.ok and jsonb_array_length(v_j) between 1 and 8
      and exists (select 1 from jsonb_array_elements(v_j) e where (e ->> 'id')::uuid = v_o and (e ->> 'kind') = 'company' and (e ->> 'org_slug') is not null)
      and not exists (select 1 from jsonb_array_elements(v_j) e where (e ->> 'kind') not in ('person', 'company') or coalesce(e ->> 'label', '') = '')
      and (v_k ->> 'ok') = 'true'
      and not exists (select 1 from jsonb_array_elements((v_k ->> 'val')::jsonb) e where (e ->> 'id')::uuid = v_a)
      and v_y.ok and v_y.val = '0', false),
    'C52 tag search -> ' || coalesce(jsonb_array_length(v_j), 0) || ' row(s) for the company''s name, the caller never listed, 1 character -> ' || coalesce(v_y.val, v_y.msg));

  -- C53 60 people told in a day per author: the 61st is refused (and nothing of that post stays)
  select * into v_x from pg_temp._dr_as('authenticated', v_b, format('select public.resource_comment_post(%L, %L)::text', v_r, 'Dry run X1'));
  v_x1 := case when v_x.ok then (v_x.val::jsonb ->> 'id')::uuid end;
  insert into public.resource_comment_notice (user_id, comment_id)
  select p.user_id, v_x1 from public.profiles p
   where v_x1 is not null and p.access_status = 'verified' and p.user_id <> v_b and p.user_id <> v_a
   order by p.user_id limit 60;
  get diagnostics v_n = row_count;
  select * into v_y from pg_temp._dr_as('authenticated', v_b, format('select public.resource_comment_post(%L, %L)::text', v_r,
    'Dry run X2 @[A](user:' || v_a::text || ')'));
  insert into _dr_res (ok, label) values (
    v_x1 is not null and v_n = 60 and not v_y.ok and v_y.msg = 'comment_tag_limit'
      and (select count(*) from public.resource_comment c where c.author_user_id = v_b) = 1,
    'C53 61st person told in a day -> ' || coalesce(v_y.state || ' ' || v_y.msg, 'ok') || ' (' || v_n || ' notices before)');

  -- C54 the same limit on an edit that swaps the tags (the 60 notices it withdraws still count)
  select * into v_x from pg_temp._dr_as('authenticated', v_b, format('select public.resource_comment_edit(%L, %L)::text', v_x1,
    'Dry run X1 @[A](user:' || v_a::text || ')'));
  insert into _dr_res (ok, label) values (
    not v_x.ok and v_x.msg = 'comment_tag_limit'
      and (select c.body from public.resource_comment c where c.id = v_x1) = 'Dry run X1'
      and (select count(*) from public.resource_comment_notice n where n.comment_id = v_x1 and n.withdrawn_at is null) = 60,
    'C54 an edit swapping the tags past the limit -> ' || coalesce(v_x.state || ' ' || v_x.msg, 'ok'));

  -- C55 deleting makes no room: B deletes X1 (its 60 notices withdrawn, kept), a new tag is still refused
  select * into v_x from pg_temp._dr_as('authenticated', v_b, format('select public.resource_comment_delete(%L)::text', v_x1));
  select * into v_y from pg_temp._dr_as('authenticated', v_b, format('select public.resource_comment_post(%L, %L)::text', v_r,
    'Dry run X3 @[A](user:' || v_a::text || ')'));
  insert into _dr_res (ok, label) values (
    v_x.ok and not v_y.ok and v_y.msg = 'comment_tag_limit'
      and (select count(*) from public.resource_comment_notice n where n.comment_id = v_x1 and n.withdrawn_at is not null) = 60,
    'C55 delete, then tag again -> ' || coalesce(v_y.state || ' ' || v_y.msg, 'ok'));

  -- C56 10 comments an hour: A's comments of this run count (deleted ones too), then refused
  select count(*) into v_mine_hour from public.resource_comment c
   where c.author_user_id = v_a and c.created_at > now() - interval '1 hour';
  for i in 1..12 loop
    select * into v_x from pg_temp._dr_as('authenticated', v_a, format('select public.resource_comment_post(%L, %L)::text', v_r, 'Dry run ' || i));
    if not v_x.ok then
      v_last := v_x.msg;
      exit;
    end if;
    v_succ := v_succ + 1;
  end loop;
  insert into _dr_res (ok, label) values (v_succ = 10 - v_mine_hour and v_last = 'comment_rate_limited',
    'C56 hourly limit: ' || v_mine_hour || ' already, ' || v_succ || ' more post(s), then ' || coalesce(v_last, 'nothing'));

  -- C57 nothing else moved (the switches put back as they were)
  update public.platform_settings ps set value = (select f.v from _dr_flag f) where ps.key = 'registration_flags';
  insert into _dr_res (ok, label) values (
    not exists ((select t.t, t.n, t.m from _dr_tab t where t.t <> 'notification_outbox')
                except
                (select 'resources'::text, count(*), md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.resources x
                 union all select 'organizations', count(*), md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.organizations x
                 union all select 'profiles', count(*), md5(coalesce(string_agg(x::text, '|' order by x.user_id), '')) from public.profiles x
                 union all select 'organization_members', count(*), md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.organization_members x))
      and (select t.m from _dr_tab t where t.t = 'notification_outbox')
          = (select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.notification_outbox x
              where x.kind not in ('comment_mention', 'comment_report'))
      and (select ps.value from public.platform_settings ps where ps.key = 'registration_flags') is not distinct from (select f.v from _dr_flag f)
      and not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                      except
                      (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                         from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn) + 24,
    'C57 resources, organizations, profiles, organization_members, the other queued e-mails, the switches and every other public function unchanged; 24 functions added');

  -- Both switches on again, for the down to take out (E4)
  update public.platform_settings ps set value = ps.value || '{"article_comments": true, "article_comment_emails": true}'::jsonb
   where ps.key = 'registration_flags';
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021130000_article_comments.sql
-- Removes the article comments: the functions, the four tables (every comment, tag, report and
-- notice is lost: export them first if they matter), the two comment kinds of
-- notification_outbox (their queued or sent rows are deleted, then the list of kinds is the
-- eight of Phase 3 again) and the two switches registration_flags.article_comments and
-- article_comment_emails (left on, the redesign's pages would show a comments section whose
-- every call fails). Refused while another SQL function still calls one of the functions it drops.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.prosrc ilike '%resource_comment%' or p.prosrc ilike '%resource_comments_%')
     and p.proname not in (
       'resource_comments_on', 'resource_comment_emails_on', 'resource_comment_gate', 'resource_comment_staff',
       'resource_comment_reader_ok', 'resource_comment_clean', 'resource_comment_label', 'resource_comment_plain',
       'resource_comment_excerpt', 'resource_comment_prepare', 'resource_comment_recipients', 'resource_comment_notify',
       'resource_comment_post', 'resource_comment_edit', 'resource_comment_delete', 'resource_comment_report',
       'resource_comments_list', 'resource_comment_count', 'resource_comment_mention_search',
       'resource_comment_my_notices', 'resource_comment_mark_seen',
       'admin_resource_comment_moderate', 'admin_resource_comment_reports', 'resource_comment_email');
  if v_bad is not null then
    raise exception 'article_comments down: other SQL function(s) use the comments: %', v_bad;
  end if;
end
$pre$;

-- The switches first: nothing about comments shows any more.
update public.platform_settings ps
   set value = ps.value - 'article_comments' - 'article_comment_emails'
 where ps.key = 'registration_flags'
   and jsonb_typeof(ps.value) = 'object'
   and ((ps.value -> 'article_comments') is not null or (ps.value -> 'article_comment_emails') is not null);

drop function if exists
  public.resource_comment_email(bigint),
  public.admin_resource_comment_reports(boolean),
  public.admin_resource_comment_moderate(uuid, text, text),
  public.resource_comment_mark_seen(bigint[]),
  public.resource_comment_my_notices(),
  public.resource_comment_mention_search(text),
  public.resource_comment_count(uuid),
  public.resource_comments_list(uuid),
  public.resource_comment_report(uuid, text),
  public.resource_comment_delete(uuid),
  public.resource_comment_edit(uuid, text),
  public.resource_comment_post(uuid, text),
  public.resource_comment_notify(uuid),
  public.resource_comment_recipients(uuid),
  public.resource_comment_prepare(text),
  public.resource_comment_excerpt(text, integer),
  public.resource_comment_plain(text),
  public.resource_comment_label(text),
  public.resource_comment_clean(text, integer),
  public.resource_comment_reader_ok(uuid, text),
  public.resource_comment_staff(),
  public.resource_comment_gate(uuid, boolean),
  public.resource_comment_emails_on(),
  public.resource_comments_on();

drop table if exists public.resource_comment_notice, public.resource_comment_report, public.resource_comment_mention, public.resource_comment;

delete from public.notification_outbox o where o.kind in ('comment_mention', 'comment_report');
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'account_under_review', 'team_join_request',
  'user_account_approved', 'user_account_rejected', 'account_info_requested', 'company_validated',
  'claim_approved', 'claim_declined'));

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (
    to_regclass('public.resource_comment') is null and to_regclass('public.resource_comment_mention') is null
      and to_regclass('public.resource_comment_report') is null and to_regclass('public.resource_comment_notice') is null
      and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                       and (p.proname like 'resource\_comment%' or p.proname like 'admin\_resource\_comment%')),
    'E1 down dropped the 4 tables and the 24 functions');
  insert into _dr_res (ok, label) values (
    (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass)
      = (select d.d from _dr_def d)
      and not exists (select 1 from public.notification_outbox o where o.kind in ('comment_mention', 'comment_report')),
    'E2 notification_outbox kinds back to the 8 of Phase 3, no comment e-mail left');
  insert into _dr_res (ok, label) values (
    not exists ((select f.fn, f.acl, f.m from _dr_fn f)
                except
                (select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), md5(p.prosrc)
                   from pg_proc p where p.pronamespace = 'public'::regnamespace))
      and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace) = (select count(*) from _dr_fn),
    'E3 public functions back to the snapshot (' || (select count(*) from _dr_fn) || ')');
  -- Both comment switches were on just before the down: it took them out, the rest as before.
  insert into _dr_res (ok, label) values (
    (select t.m from _dr_tab t where t.t = 'notification_outbox')
      = (select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.notification_outbox x)
      and (select ps.value from public.platform_settings ps where ps.key = 'registration_flags')
          is not distinct from (select f.v - 'article_comments' - 'article_comment_emails' from _dr_flag f)
      and (select (ps.value -> 'article_comments') is null and (ps.value -> 'article_comment_emails') is null
             from public.platform_settings ps where ps.key = 'registration_flags'),
    'E4 notification_outbox rows as before; the down took out article_comments and article_comment_emails, the other switches as before');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (article_comments, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
