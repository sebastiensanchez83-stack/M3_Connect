-- DRY RUN of supabase/migrations/20261021175000_market_requests.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- Fixtures: real accounts are only READ (a verified admin = staff, a verified member who is not
-- staff, a verified member who plays the requester, a suspended account if there is one); one
-- RFP, one consultation, one marina project and one partner lead are inserted with fictional
-- text. The e-mail sender switch (registration_flags.outbox_sender) is turned off, then on, inside
-- the run. Every call runs as its real role (set local role + request.jwt.claims): a visitor
-- (anon), a member, the requester, M3 staff, the e-mail sender (service_role). Then the down,
-- verbatim, and checks again. Nothing is sent (no function calls send-notification) and every row
-- written lives in this transaction only. Prints statuses, counts and SQLSTATEs, never names or
-- addresses.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "DRYRUN 27 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Helpers, fixtures, the "before" figures
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_fx (k text primary key, u uuid, t text) on commit drop;

-- One call as a role and an account. Keeps what it wrote (the whole run is rolled back at the
-- end); answers the call's value as jsonb, or {"_err": SQLSTATE, "msg": message}.
create function pg_temp._dr_json(p_role text, p_uid uuid, p_sql text) returns jsonb
language plpgsql as $dr$
declare
  v_val text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_val;
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('_err', sqlstate, 'msg', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_val, 'null')::jsonb;
end
$dr$;

-- 'ok', or 'SQLSTATE:message' of the error.
create function pg_temp._dr_err(p_role text, p_uid uuid, p_sql text) returns text
language plpgsql as $dr$
declare
  v_j jsonb := pg_temp._dr_json(p_role, p_uid, p_sql);
begin
  if jsonb_typeof(v_j) = 'object' and v_j ? '_err' then
    return (v_j ->> '_err') || ':' || (v_j ->> 'msg');
  end if;
  return 'ok';
end
$dr$;

-- One result line: ok when every got equals its want.
create function pg_temp._dr_line(p_label text, p_got text[], p_want text[]) returns void
language plpgsql as $dr$
declare
  v_ok boolean := array_length(p_got, 1) = array_length(p_want, 1);
  v_txt text := '';
  i int;
begin
  for i in 1 .. coalesce(array_length(p_got, 1), 0) loop
    v_ok := v_ok and p_got[i] is not distinct from p_want[i];
    v_txt := v_txt || case when i > 1 then ', ' else '' end || coalesce(p_got[i], 'null')
             || case when p_got[i] is distinct from p_want[i] then ' (want ' || coalesce(p_want[i], 'null') || ')' else '' end;
  end loop;
  insert into pg_temp._dr_res (ok, label) values (coalesce(v_ok, false), p_label || ': ' || v_txt);
end
$dr$;

do $a$
declare
  v_adm uuid;
  v_mem uuid;
  v_auth uuid;
  v_auth_marina boolean;
  v_susp uuid;
  v_r1 uuid;
  v_r2 uuid;
  v_c1 uuid;
  v_p1 uuid;
  v_l1 uuid;
begin
  select p.user_id into v_adm from public.profiles p join auth.users u on u.id = p.user_id
   where p.persona = 'admin' and p.access_status = 'verified' order by p.user_id limit 1;
  -- The requester: a verified marina if there is one (the owner policies of rfps are for marinas).
  select p.user_id, p.persona::text = 'marina' into v_auth, v_auth_marina
    from public.profiles p join auth.users u on u.id = p.user_id
   where p.persona::text not in ('admin', 'moderator') and p.access_status = 'verified'
   order by (p.persona::text = 'marina') desc, p.user_id limit 1;
  select p.user_id into v_mem from public.profiles p join auth.users u on u.id = p.user_id
   where p.persona::text not in ('admin', 'moderator') and p.access_status = 'verified' and p.user_id <> v_auth
   order by p.user_id limit 1;
  select p.user_id into v_susp from public.profiles p join auth.users u on u.id = p.user_id
   where p.access_status = 'suspended' order by p.user_id limit 1;
  if v_adm is null or v_mem is null or v_auth is null then
    raise exception 'DRYRUN 0 PASS, 1 FAIL (fixtures missing: admin %, member %, requester %)',
      v_adm is not null, v_mem is not null, v_auth is not null;
  end if;

  insert into public.rfps (marina_user_id, title, scope, deadline_date, status)
  values (v_auth, 'DRYRUN rfp', 'DRYRUN scope', date '2026-12-01', 'submitted') returning id into v_r1;
  if v_susp is not null then
    insert into public.rfps (marina_user_id, title, scope, status)
    values (v_susp, 'DRYRUN rfp of a suspended account', 'DRYRUN scope', 'submitted') returning id into v_r2;
  end if;
  insert into public.consultations (marina_user_id, title, description, status)
  values (v_auth, 'DRYRUN consultation', 'DRYRUN description', 'submitted') returning id into v_c1;
  insert into public.marina_projects (user_id, project_type, budget_range, timeline, description, status)
  values (v_auth, 'energy', '10k_50k', '0_12_months', 'DRYRUN project', 'new') returning id into v_p1;
  insert into public.partner_leads (first_name, last_name, email, company, country, actor_type, engagement_level, status)
  values ('Dry', 'Run', 'dryrun-lead@example.invalid', 'DRYRUN Co', 'Monaco', 'partner', 'info', 'new') returning id into v_l1;

  insert into _dr_fx (k, u, t) values
    ('adm', v_adm, null), ('mem', v_mem, null), ('auth', v_auth, v_auth_marina::text), ('susp', v_susp, null),
    ('r1', v_r1, null), ('r2', v_r2, null), ('c1', v_c1, null), ('p1', v_p1, null), ('l1', v_l1, null),
    ('log_total', null, (select count(*)::text from public.review_log)),
    ('outbox_total', null, (select count(*)::text from public.notification_outbox)),
    ('kinds_def', null, (select pg_get_constraintdef(c.oid) from pg_constraint c
                          where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass)),
    ('types_def', null, (select pg_get_constraintdef(c.oid) from pg_constraint c
                          where c.conname = 'review_log_subject_type_check' and c.conrelid = 'public.review_log'::regclass));
  insert into _dr_res (ok, label) values (true, format(
    'F0 fixtures: an admin, a member, a requester (marina: %s), a suspended account: %s; review_log %s rows, outbox %s rows',
    v_auth_marina, v_susp is not null, (select t from _dr_fx where k = 'log_total'), (select t from _dr_fx where k = 'outbox_total')));
end
$a$;

-- B. The migration, verbatim
-- Admin redesign, wave 2, lane "market" (Victor, 21 Oct 2026: "Les demandes du marché ne vont pas
-- au bout"): the four marketplace requests (RFPs, consultations, marina projects, partner leads)
-- get ONE staff screen, Admin > Marketplace > Marina requests, where M3 answers them to the end:
-- change the status with a message to the requester, correct their text, keep internal notes,
-- and the e-mail to the requester.
-- NOT APPLIED. Apply with Victor's OK, after the dry run
-- supabase/dryrun/20261021175000_market_requests.dryrun.sql (it runs this file, checks it as a
-- visitor, a member, the requester and M3 staff, then runs the down, in one rolled-back
-- transaction). Down: supabase/migrations/down/20261021175000_market_requests.down.sql.
-- How the e-mails go out: docs/operations/market-requests.md.
--
-- ADDITIVE, harmless for the live site (branch main never names these objects; its four admin
-- screens keep updating the four tables directly through their existing staff policies):
--  1. notification_outbox accepts one more kind, 'market_request_status' (the ten kinds of
--     20261021130000_article_comments stay as they are).
--  2. review_log accepts one more subject_type, 'market_request' (the six of Phase 3 stay). Its
--     actions here: request_status, request_edited, request_note. Never the queue's own action
--     names (validated, rejected, ...): review_queue_rows reads those without a subject_type.
--  3. Three staff functions, one per action. Staff = verified admins and moderators
--     (public.is_moderator(), the test of the four tables' staff policies). SECURITY DEFINER,
--     search_path '', every table schema-qualified, EXECUTE for authenticated only:
--       admin_market_request_set_status(kind, id, status, message, notify)
--       admin_market_request_edit(kind, id, changes)
--       admin_market_request_note(kind, id, note)
--  4. market_request_email(outbox id): every word of one queued e-mail, read from the database
--     by send-notification (service_role only).
--  5. Four helpers without any grant (only the functions above call them).
--
-- The rules:
--  - kind: 'rfp' (public.rfps), 'consultation' (public.consultations), 'project'
--    (public.marina_projects), 'lead' (public.partner_leads). The statuses are each table's own
--    CHECK list.
--  - The e-mail goes to the request's AUTHOR account only (rfps.marina_user_id,
--    consultations.marina_user_id, marina_projects.user_id), read from the row, never from the
--    caller, and never to a suspended account. Only for: RFPs and consultations approved
--    (published), rejected (the reason is then required: the requester also reads it on the
--    site) or closed; marina projects approved, rejected or completed. M3 may untick "Tell them
--    by e-mail". Before go-live (sender off) a change is logged as sender_off whatever the
--    box says. Never for a partner lead (a sales contact without an account, from the old
--    public "become a partner" form: M3 answers them in person), never for a correction of the
--    text, never for a note.
--  - One e-mail per status change (dedupe_key 'market_request_status:<review_log id>'). A newer
--    status change of the same request settles the older e-mail that has not left ("not sent:
--    ..."), and market_request_email answers "out of date" when the request's status is no
--    longer the one of the e-mail (also after a change made on the live site's old screens).
--  - Queued only while registration_flags.outbox_sender is JSON true (the sender of the database
--    queue, off until go-live): before that a status change e-mails nobody, now or later
--    (Victor's rule for the comments, 21 Oct 2026: nothing piles up to leave on day D).
--  - Every action writes one review_log row: the history of the request page. Notes live in
--    review_log only (staff read it); the tables' old admin_notes column is readable by the
--    request's author through the API (and, for RFPs and consultations, by every member with
--    marketplace access: their read policies return every row and column), so this page never
--    writes it.
--  - rejection_reason holds the reason of the CURRENT refusal only: any other status clears it
--    (rfps and consultations are readable by marketplace members, so an old refusal must not stay
--    readable on a published request). The reason is kept in review_log.note either way.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_def text;
begin
  if to_regprocedure('public.admin_market_request_set_status(text,uuid,text,text,boolean)') is not null
     or to_regprocedure('public.admin_market_request_edit(text,uuid,jsonb)') is not null
     or to_regprocedure('public.admin_market_request_note(text,uuid,text)') is not null
     or to_regprocedure('public.market_request_email(bigint)') is not null then
    raise exception 'market_requests: already installed';
  end if;
  -- The helper it relies on, as it was on 21 Oct 2026.
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.is_moderator()')) is distinct from 'cb9c826f94db460c5b63f9830ae12361' then
    raise exception 'market_requests: public.is_moderator() changed since 21 Oct; check it again';
  end if;
  if to_regclass('public.rfps') is null or to_regclass('public.consultations') is null or to_regclass('public.marina_projects') is null
     or to_regclass('public.partner_leads') is null or to_regclass('public.review_log') is null
     or to_regclass('public.notification_outbox') is null or to_regclass('public.platform_settings') is null then
    raise exception 'market_requests: a table it needs is missing';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public'
         and ((c.table_name = 'rfps' and c.column_name in ('marina_user_id', 'title', 'scope', 'deadline_date', 'status', 'rejection_reason'))
           or (c.table_name = 'consultations' and c.column_name in ('marina_user_id', 'title', 'description', 'status', 'rejection_reason'))
           or (c.table_name = 'marina_projects' and c.column_name in ('user_id', 'project_type', 'budget_range', 'timeline', 'description', 'status', 'rejection_reason'))
           or (c.table_name = 'partner_leads' and c.column_name in ('first_name', 'last_name', 'email', 'phone', 'company', 'website', 'country',
                                                                    'actor_type', 'solutions', 'goals', 'engagement_level', 'status')))) <> 30 then
    raise exception 'market_requests: the columns of rfps, consultations, marina_projects or partner_leads changed';
  end if;
  -- The two lists below are replaced by fixed ones: refuse if another file changed them since
  -- (they would be lost silently; merge the lists in this file first).
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass;
  if v_def is distinct from 'CHECK ((kind = ANY (ARRAY[''account_under_review''::text, ''team_join_request''::text, ''user_account_approved''::text, ''user_account_rejected''::text, ''account_info_requested''::text, ''company_validated''::text, ''claim_approved''::text, ''claim_declined''::text, ''comment_mention''::text, ''comment_report''::text])))' then
    raise exception 'market_requests: notification_outbox kinds changed (%); merge the lists in this file', v_def;
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'review_log_subject_type_check' and c.conrelid = 'public.review_log'::regclass;
  if v_def is distinct from 'CHECK ((subject_type = ANY (ARRAY[''person''::text, ''company''::text, ''registration''::text, ''claim''::text, ''join''::text, ''merge''::text])))' then
    raise exception 'market_requests: review_log subject types changed (%); merge the lists in this file', v_def;
  end if;
end
$pre$;

-- ---- 1. The outbox accepts the status e-mail; review_log the requests --------------------

alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'account_under_review', 'team_join_request',
  'user_account_approved', 'user_account_rejected', 'account_info_requested', 'company_validated',
  'claim_approved', 'claim_declined',
  'comment_mention', 'comment_report',
  'market_request_status'));

alter table public.review_log drop constraint review_log_subject_type_check;
alter table public.review_log add constraint review_log_subject_type_check check (subject_type in (
  'person', 'company', 'registration', 'claim', 'join', 'merge',
  'market_request'));

-- ---- 2. Helpers (no grant: called by the functions below only) ---------------------------

-- The statuses of each kind (its table's CHECK list), in the order the page shows them; null for
-- an unknown kind.
create function public.market_request_statuses(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select case p_kind
    when 'rfp' then array['submitted', 'under_review', 'approved', 'closed', 'rejected', 'archived']
    when 'consultation' then array['submitted', 'under_review', 'approved', 'closed', 'rejected', 'archived']
    when 'project' then array['new', 'submitted', 'under_review', 'approved', 'in_progress', 'completed', 'rejected', 'archived']
    when 'lead' then array['new', 'qualified', 'in_discussion', 'signed', 'rejected']
  end
$fn$;

-- Whether moving a request of this kind to this status e-mails its author.
create function public.market_request_mails(p_kind text, p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_kind in ('rfp', 'consultation') then coalesce(p_status in ('approved', 'rejected', 'closed'), false)
    when p_kind = 'project' then coalesce(p_status in ('approved', 'rejected', 'completed'), false)
    else false
  end
$fn$;

-- The database queue's e-mails are being sent: registration_flags.outbox_sender, JSON true only.
create function public.market_request_emails_on()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce((select (ps.value -> 'outbox_sender') = 'true'::jsonb
                     from public.platform_settings ps where ps.key = 'registration_flags'), false)
$fn$;

-- One request as the functions need it: {status, author_id, title}; null when there is none.
create function public.market_request_row(p_kind text, p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select case p_kind
    when 'rfp' then (
      select jsonb_build_object('status', r.status, 'author_id', r.marina_user_id, 'title', r.title)
        from public.rfps r where r.id = p_id)
    when 'consultation' then (
      select jsonb_build_object('status', c.status, 'author_id', c.marina_user_id, 'title', c.title)
        from public.consultations c where c.id = p_id)
    when 'project' then (
      select jsonb_build_object('status', mp.status, 'author_id', mp.user_id, 'title',
               coalesce(nullif(initcap(replace(btrim(coalesce(mp.project_type, '')), '_', ' ')), ''), 'Marina') || ' project')
        from public.marina_projects mp where mp.id = p_id)
    when 'lead' then (
      select jsonb_build_object('status', pl.status, 'author_id', null, 'title', pl.company)
        from public.partner_leads pl where pl.id = p_id)
  end
$fn$;

-- ---- 3. Staff: change the status (and queue the e-mail to the author) ---------------------
-- p_message: for 'rejected' (RFP, consultation, project) the reason, required: stored as the
-- request's rejection_reason (the author reads it on the site) and sent in the e-mail. For any
-- other status an optional message added to the e-mail, and rejection_reason is cleared. Always
-- kept in review_log.note.
-- p_notify false: no e-mail, even for a status that sends one.
-- Answer: {ok, kind, id, from, to, email, outbox_id, review_log_id}; email says what happened:
-- queued, sender_off (before go-live), not_asked, not_for_this_status, not_for_leads,
-- no_author, author_suspended.
create function public.admin_market_request_set_status(
  p_kind text, p_id uuid, p_status text, p_message text default null, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_to text := lower(btrim(coalesce(p_status, '')));
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_from text;
  v_author uuid;
  v_author_status text;
  v_email text;
  v_log bigint;
  v_outbox bigint;
begin
  if v_uid is null or not public.is_moderator() then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if public.market_request_statuses(v_kind) is null then
    raise exception using errcode = '22023', message = 'unknown_kind';
  end if;
  if not (v_to = any (public.market_request_statuses(v_kind))) then
    raise exception using errcode = '22023', message = 'unknown_status';
  end if;
  if char_length(coalesce(v_msg, '')) > 2000 then
    raise exception using errcode = '22023', message = 'message_too_long';
  end if;
  if v_to = 'rejected' and v_kind <> 'lead' and v_msg is null then
    raise exception using errcode = '22023', message = 'reason_required';
  end if;

  if v_kind = 'rfp' then
    select r.status, r.marina_user_id into v_from, v_author from public.rfps r where r.id = p_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
    if v_from is not distinct from v_to then raise exception using errcode = '22023', message = 'same_status'; end if;
    update public.rfps r
       set status = v_to, rejection_reason = case when v_to = 'rejected' then v_msg end
     where r.id = p_id;
  elsif v_kind = 'consultation' then
    select c.status, c.marina_user_id into v_from, v_author from public.consultations c where c.id = p_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
    if v_from is not distinct from v_to then raise exception using errcode = '22023', message = 'same_status'; end if;
    update public.consultations c
       set status = v_to, rejection_reason = case when v_to = 'rejected' then v_msg end
     where c.id = p_id;
  elsif v_kind = 'project' then
    select mp.status, mp.user_id into v_from, v_author from public.marina_projects mp where mp.id = p_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
    if v_from is not distinct from v_to then raise exception using errcode = '22023', message = 'same_status'; end if;
    update public.marina_projects mp
       set status = v_to, rejection_reason = case when v_to = 'rejected' then v_msg end
     where mp.id = p_id;
  else
    select pl.status into v_from from public.partner_leads pl where pl.id = p_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
    if v_from is not distinct from v_to then raise exception using errcode = '22023', message = 'same_status'; end if;
    update public.partner_leads pl set status = v_to where pl.id = p_id;
  end if;

  if v_author is not null then
    select p.access_status::text into v_author_status from public.profiles p where p.user_id = v_author;
  end if;
  v_email := case
    when v_kind = 'lead' then 'not_for_leads'
    when not public.market_request_mails(v_kind, v_to) then 'not_for_this_status'
    when not public.market_request_emails_on() then 'sender_off'
    when not coalesce(p_notify, true) then 'not_asked'
    when v_author is null or not exists (select 1 from auth.users u where u.id = v_author) then 'no_author'
    when v_author_status = 'suspended' then 'author_suspended'
    else 'queued'
  end;

  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('market_request', p_id, 'request_status', v_msg,
          jsonb_build_object('kind', v_kind, 'from', v_from, 'to', v_to, 'email', v_email), v_uid)
  returning id into v_log;

  -- An earlier e-mail of this request that has not left is out of date now.
  update public.notification_outbox o
     set sent_at = now(), last_error = 'not sent: a newer status change replaced it'
   where o.kind = 'market_request_status' and o.subject_id = p_id and o.sent_at is null;

  if v_email = 'queued' then
    insert into public.notification_outbox (kind, user_id, actor_id, subject_id, dedupe_key, data)
    values ('market_request_status', v_author, v_uid, p_id, 'market_request_status:' || v_log::text,
            jsonb_build_object('request_kind', v_kind, 'status', v_to, 'review_log_id', v_log))
    on conflict (dedupe_key) do nothing
    returning id into v_outbox;
    update public.review_log l set details = l.details || jsonb_build_object('outbox_id', v_outbox) where l.id = v_log;
  end if;

  return jsonb_build_object('ok', true, 'kind', v_kind, 'id', p_id, 'from', v_from, 'to', v_to,
                            'email', v_email, 'outbox_id', v_outbox, 'review_log_id', v_log);
end
$fn$;

-- ---- 4. Staff: correct what the requester wrote (logged, never e-mailed) ------------------
-- p_changes: {field: "new text" | null}, only the fields of that kind below; empty text = none.
-- Answer: {ok, changed, review_log_id}; changed 0 (no log row) when nothing differs.
create function public.admin_market_request_edit(p_kind text, p_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_fields text[];
  v_required text[];
  v_old jsonb;
  v_new jsonb;
  v_set jsonb := '{}'::jsonb;
  v_diff jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_txt text;
  v_max int;
  v_log bigint;
begin
  if v_uid is null or not public.is_moderator() then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  v_fields := case v_kind
    when 'rfp' then array['title', 'scope', 'deadline_date']
    when 'consultation' then array['title', 'description']
    when 'project' then array['project_type', 'budget_range', 'timeline', 'description']
    when 'lead' then array['first_name', 'last_name', 'email', 'phone', 'company', 'website', 'country',
                           'actor_type', 'solutions', 'goals', 'engagement_level']
  end;
  if v_fields is null then
    raise exception using errcode = '22023', message = 'unknown_kind';
  end if;
  v_required := case v_kind
    when 'rfp' then array['title', 'scope']
    when 'consultation' then array['title', 'description']
    when 'project' then array['project_type']
    else array['first_name', 'last_name', 'email', 'company']
  end;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'nothing_to_change';
  end if;

  for v_key, v_val in select e.key, e.value from jsonb_each(p_changes) e loop
    if not (v_key = any (v_fields)) then
      raise exception using errcode = '22023', message = 'field_not_editable', detail = left(v_key, 60);
    end if;
    if jsonb_typeof(v_val) not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'bad_value', detail = v_key;
    end if;
    v_txt := nullif(btrim(coalesce(v_val #>> '{}', '')), '');
    if v_txt is null and v_key = any (v_required) then
      raise exception using errcode = '22023', message = 'required_field', detail = v_key;
    end if;
    v_max := case v_key
      when 'title' then 200 when 'company' then 200 when 'first_name' then 100 when 'last_name' then 100
      when 'email' then 254 when 'phone' then 50 when 'website' then 300 when 'country' then 100
      when 'actor_type' then 60 when 'project_type' then 60 when 'budget_range' then 60 when 'timeline' then 60
      when 'engagement_level' then 20 when 'deadline_date' then 10
      else 20000
    end;
    if char_length(coalesce(v_txt, '')) > v_max then
      raise exception using errcode = '22023', message = 'too_long', detail = v_key;
    end if;
    if v_key = 'deadline_date' and v_txt is not null then
      if v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode = '22023', message = 'bad_date';
      end if;
      begin
        perform v_txt::date;
      exception when others then
        raise exception using errcode = '22023', message = 'bad_date';
      end;
    end if;
    if v_key = 'email' and v_txt !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'bad_email';
    end if;
    if v_key = 'engagement_level' and v_txt is not null and v_txt not in ('info', 'meeting', 'proposal') then
      raise exception using errcode = '22023', message = 'bad_value', detail = v_key;
    end if;
    v_set := v_set || jsonb_build_object(v_key, v_txt);
  end loop;

  if v_kind = 'rfp' then
    select to_jsonb(r) into v_old from public.rfps r where r.id = p_id for update;
  elsif v_kind = 'consultation' then
    select to_jsonb(c) into v_old from public.consultations c where c.id = p_id for update;
  elsif v_kind = 'project' then
    select to_jsonb(mp) into v_old from public.marina_projects mp where mp.id = p_id for update;
  else
    select to_jsonb(pl) into v_old from public.partner_leads pl where pl.id = p_id for update;
  end if;
  if v_old is null then
    raise exception using errcode = 'P0002', message = 'not_found';
  end if;

  for v_key in select jsonb_object_keys(v_set) loop
    if (v_old -> v_key) is distinct from (v_set -> v_key) then
      v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_set -> v_key));
    end if;
  end loop;
  if v_diff = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'changed', 0);
  end if;

  v_new := v_old || v_set;
  if v_kind = 'rfp' then
    update public.rfps r
       set title = v_new ->> 'title', scope = v_new ->> 'scope', deadline_date = (v_new ->> 'deadline_date')::date
     where r.id = p_id;
  elsif v_kind = 'consultation' then
    update public.consultations c
       set title = v_new ->> 'title', description = v_new ->> 'description'
     where c.id = p_id;
  elsif v_kind = 'project' then
    update public.marina_projects mp
       set project_type = v_new ->> 'project_type', budget_range = v_new ->> 'budget_range',
           timeline = v_new ->> 'timeline', description = v_new ->> 'description'
     where mp.id = p_id;
  else
    update public.partner_leads pl
       set first_name = v_new ->> 'first_name', last_name = v_new ->> 'last_name', email = v_new ->> 'email',
           phone = v_new ->> 'phone', company = v_new ->> 'company', website = v_new ->> 'website',
           country = v_new ->> 'country', actor_type = v_new ->> 'actor_type', solutions = v_new ->> 'solutions',
           goals = v_new ->> 'goals', engagement_level = v_new ->> 'engagement_level'
     where pl.id = p_id;
  end if;

  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('market_request', p_id, 'request_edited', null, jsonb_build_object('kind', v_kind, 'fields', v_diff), v_uid)
  returning id into v_log;

  return jsonb_build_object('ok', true, 'changed', (select count(*) from jsonb_object_keys(v_diff)), 'review_log_id', v_log);
end
$fn$;

-- ---- 5. Staff: an internal note on a request (review_log only, staff read) ----------------
create function public.admin_market_request_note(p_kind text, p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_log bigint;
begin
  if v_uid is null or not public.is_moderator() then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if public.market_request_statuses(v_kind) is null then
    raise exception using errcode = '22023', message = 'unknown_kind';
  end if;
  if v_note is null then
    raise exception using errcode = '22023', message = 'note_required';
  end if;
  if char_length(v_note) > 4000 then
    raise exception using errcode = '22023', message = 'too_long';
  end if;
  if public.market_request_row(v_kind, p_id) is null then
    raise exception using errcode = 'P0002', message = 'not_found';
  end if;
  insert into public.review_log (subject_type, subject_id, action, note, details, actor_id)
  values ('market_request', p_id, 'request_note', v_note, jsonb_build_object('kind', v_kind), v_uid)
  returning id into v_log;
  return jsonb_build_object('ok', true, 'review_log_id', v_log);
end
$fn$;

-- ---- 6. Everything send-notification needs for one queued e-mail (service_role only) ------
-- {ok, user_id, request_id, request_kind, status, title, message, first_name}, or
-- {ok false, sent true} (already sent or settled), or {ok false, stale true, why} (the news is
-- out of date: the sender settles the row unsent).
create function public.market_request_email(p_outbox_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_o record;
  v_kind text;
  v_status text;
  v_log bigint;
  v_row jsonb;
  v_first text;
  v_access text;
  v_msg text;
begin
  select o.id, o.kind, o.user_id, o.subject_id, o.data, o.sent_at, o.created_at into v_o
    from public.notification_outbox o where o.id = p_outbox_id;
  if not found then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'the queued e-mail no longer exists');
  end if;
  if v_o.kind <> 'market_request_status' then
    return jsonb_build_object('ok', false, 'error', 'not a marina request e-mail');
  end if;
  if v_o.sent_at is not null then
    return jsonb_build_object('ok', false, 'sent', true);
  end if;
  v_kind := v_o.data ->> 'request_kind';
  v_status := v_o.data ->> 'status';
  v_log := case when (v_o.data ->> 'review_log_id') ~ '^[0-9]{1,18}$' then (v_o.data ->> 'review_log_id')::bigint end;
  if v_log is null or not public.market_request_mails(v_kind, v_status) then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'not a status this page e-mails');
  end if;
  if v_o.created_at < now() - interval '72 hours' then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'queued more than 72 hours ago: never sent late');
  end if;
  v_row := public.market_request_row(v_kind, v_o.subject_id);
  if v_row is null then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'the request was deleted');
  end if;
  if (v_row ->> 'status') is distinct from v_status then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'the status changed again before the e-mail left');
  end if;
  if (v_row ->> 'author_id') is distinct from v_o.user_id::text then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'the request has another author now');
  end if;
  if exists (select 1 from public.review_log l
              where l.subject_type = 'market_request' and l.subject_id = v_o.subject_id
                and l.action = 'request_status' and l.id > v_log) then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'a newer status change replaced it');
  end if;
  select p.first_name, p.access_status::text into v_first, v_access from public.profiles p where p.user_id = v_o.user_id;
  if not found then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'the author account no longer exists');
  end if;
  if v_access = 'suspended' then
    return jsonb_build_object('ok', false, 'stale', true, 'why', 'the author account is suspended');
  end if;
  select l.note into v_msg from public.review_log l where l.id = v_log;
  return jsonb_build_object('ok', true, 'user_id', v_o.user_id, 'request_id', v_o.subject_id,
                            'request_kind', v_kind, 'status', v_status, 'title', v_row ->> 'title',
                            'message', v_msg, 'first_name', v_first);
end
$fn$;

-- ---- 7. Grants ---------------------------------------------------------------------------

revoke all on function
  public.market_request_statuses(text),
  public.market_request_mails(text, text),
  public.market_request_emails_on(),
  public.market_request_row(text, uuid),
  public.admin_market_request_set_status(text, uuid, text, text, boolean),
  public.admin_market_request_edit(text, uuid, jsonb),
  public.admin_market_request_note(text, uuid, text),
  public.market_request_email(bigint)
  from public, anon, authenticated, service_role;
grant execute on function
  public.admin_market_request_set_status(text, uuid, text, text, boolean),
  public.admin_market_request_edit(text, uuid, jsonb),
  public.admin_market_request_note(text, uuid, text)
  to authenticated;
grant execute on function public.market_request_email(bigint) to service_role;

comment on function public.admin_market_request_set_status(text, uuid, text, text, boolean) is
  'Staff: change the status of a marina request (rfp, consultation, project, lead), log it in review_log and queue the e-mail to its author (outbox_sender on, statuses that e-mail). 20261021175000.';
comment on function public.admin_market_request_edit(text, uuid, jsonb) is
  'Staff: correct the text of a marina request; logged in review_log (old and new values), never e-mailed. 20261021175000.';
comment on function public.admin_market_request_note(text, uuid, text) is
  'Staff: an internal note on a marina request, in review_log only. 20261021175000.';
comment on function public.market_request_email(bigint) is
  'send-notification (service_role): the words of one queued market_request_status e-mail, or why it is out of date. 20261021175000.';

-- C. Checks after the migration
do $c$
declare
  v_adm uuid := (select u from _dr_fx where k = 'adm');
  v_mem uuid := (select u from _dr_fx where k = 'mem');
  v_auth uuid := (select u from _dr_fx where k = 'auth');
  v_auth_marina boolean := (select t from _dr_fx where k = 'auth') = 'true';
  v_susp uuid := (select u from _dr_fx where k = 'susp');
  v_r1 uuid := (select u from _dr_fx where k = 'r1');
  v_r2 uuid := (select u from _dr_fx where k = 'r2');
  v_c1 uuid := (select u from _dr_fx where k = 'c1');
  v_p1 uuid := (select u from _dr_fx where k = 'p1');
  v_l1 uuid := (select u from _dr_fx where k = 'l1');
  v_set constant text := 'select public.admin_market_request_set_status(%L, %L, %L, %L, %L)';
  v_edit constant text := 'select public.admin_market_request_edit(%L, %L, %L::jsonb)';
  v_note constant text := 'select public.admin_market_request_note(%L, %L, %L)';
  v_mail constant text := 'select public.market_request_email(%s)';
  v_fns constant text[] := array['market_request_statuses', 'market_request_mails', 'market_request_emails_on', 'market_request_row',
                                 'admin_market_request_set_status', 'admin_market_request_edit', 'admin_market_request_note', 'market_request_email'];
  v_j jsonb;
  v_j2 jsonb;
  v_txt text;
  v_t2 text;
  v_t3 text;
  v_o1 bigint;
  v_o2 bigint;
  v_o3 bigint;
  v_logs int;
  v_outs int;
begin
  -- The e-mail sender off, as in production before go-live (missing = off).
  update public.platform_settings ps set value = ps.value - 'outbox_sender' where ps.key = 'registration_flags';

  perform pg_temp._dr_line('C01 eight functions; the outbox and review_log lists widened by one each, the others kept',
    array[(select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname::text = any (v_fns)),
          ((select pg_get_constraintdef(c.oid) from pg_constraint c
             where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass)
            = replace((select t from _dr_fx where k = 'kinds_def'), '''comment_report''::text]', '''comment_report''::text, ''market_request_status''::text]'))::text,
          ((select pg_get_constraintdef(c.oid) from pg_constraint c
             where c.conname = 'review_log_subject_type_check' and c.conrelid = 'public.review_log'::regclass)
            = replace((select t from _dr_fx where k = 'types_def'), '''merge''::text]', '''merge''::text, ''market_request''::text]'))::text],
    array['8', 'true', 'true']);

  perform pg_temp._dr_line('C02 EXECUTE: visitors none; signed-in accounts the 3 staff functions only; the sender the e-mail words only; no PUBLIC grant; every function definer-safe (search_path set)',
    array[(select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname::text = any (v_fns)
             and has_function_privilege('anon', p.oid, 'execute')),
          (select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname::text = any (v_fns) and has_function_privilege('authenticated', p.oid, 'execute')),
          (select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname::text = any (v_fns) and has_function_privilege('service_role', p.oid, 'execute')),
          (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
            where p.pronamespace = 'public'::regnamespace and p.proname::text = any (v_fns) and a.grantee = 0),
          (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname::text = any (v_fns)
             and not coalesce('search_path=""' = any (p.proconfig), false)),
          (select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname::text = any (v_fns) and p.prosecdef)],
    array['0', 'admin_market_request_edit,admin_market_request_note,admin_market_request_set_status', 'market_request_email', '0', '0',
          'admin_market_request_edit,admin_market_request_note,admin_market_request_set_status,market_request_email']);

  perform pg_temp._dr_line('C03 a visitor (anon) may call none of them',
    array[split_part(pg_temp._dr_err('anon', null, format(v_set, 'rfp', v_r1, 'approved', null, true)), ':', 1),
          split_part(pg_temp._dr_err('anon', null, format(v_edit, 'rfp', v_r1, '{"title": "x"}')), ':', 1),
          split_part(pg_temp._dr_err('anon', null, format(v_note, 'rfp', v_r1, 'x')), ':', 1),
          split_part(pg_temp._dr_err('anon', null, format(v_mail, 1)), ':', 1)],
    array['42501', '42501', '42501', '42501']);

  perform pg_temp._dr_line('C04 a member who is not staff, and the requester themself, are refused every action; neither reads the e-mail words',
    array[pg_temp._dr_err('authenticated', v_mem, format(v_set, 'rfp', v_r1, 'approved', null, true)),
          pg_temp._dr_err('authenticated', v_mem, format(v_edit, 'rfp', v_r1, '{"title": "x"}')),
          pg_temp._dr_err('authenticated', v_mem, format(v_note, 'rfp', v_r1, 'x')),
          pg_temp._dr_err('authenticated', v_auth, format(v_set, 'rfp', v_r1, 'approved', null, true)),
          pg_temp._dr_err('authenticated', v_auth, format(v_edit, 'rfp', v_r1, '{"title": "x"}')),
          split_part(pg_temp._dr_err('authenticated', v_auth, format(v_mail, 1)), ':', 1),
          (select status from public.rfps where id = v_r1)],
    array['42501:forbidden', '42501:forbidden', '42501:forbidden', '42501:forbidden', '42501:forbidden', '42501', 'submitted']);

  perform pg_temp._dr_line('C05 staff mistakes are refused: unknown kind, a status the kind does not have, rejected without a reason, the same status, no such request, a message too long',
    array[pg_temp._dr_err('authenticated', v_adm, format(v_set, 'offer', v_r1, 'approved', null, true)),
          pg_temp._dr_err('authenticated', v_adm, format(v_set, 'rfp', v_r1, 'in_progress', null, true)),
          pg_temp._dr_err('authenticated', v_adm, format(v_set, 'rfp', v_r1, 'rejected', '   ', true)),
          pg_temp._dr_err('authenticated', v_adm, format(v_set, 'rfp', v_r1, 'submitted', null, true)),
          pg_temp._dr_err('authenticated', v_adm, format(v_set, 'rfp', gen_random_uuid(), 'approved', null, true)),
          pg_temp._dr_err('authenticated', v_adm, format(v_set, 'rfp', v_r1, 'approved', repeat('x', 2001), true)),
          (select count(*)::text from public.review_log where subject_id = v_r1)],
    array['22023:unknown_kind', '22023:unknown_status', '22023:reason_required', '22023:same_status', 'P0002:not_found', '22023:message_too_long', '0']);

  -- RFP: submitted -> under review (no e-mail for this status)
  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'RFP ', v_r1, ' Under_Review', '', true));
  perform pg_temp._dr_line('C06 RFP submitted -> under review: saved and logged once, no e-mail for this status',
    array[v_j ->> 'email', v_j ->> 'from', v_j ->> 'to', (select status from public.rfps where id = v_r1),
          (select count(*)::text from public.review_log l where l.subject_type = 'market_request' and l.subject_id = v_r1
             and l.action = 'request_status' and l.actor_id = v_adm and l.note is null
             and l.details = jsonb_build_object('kind', 'rfp', 'from', 'submitted', 'to', 'under_review', 'email', 'not_for_this_status')),
          (select count(*)::text from public.notification_outbox where subject_id = v_r1)],
    array['not_for_this_status', 'submitted', 'under_review', 'under_review', '1', '0']);

  -- RFP: under review -> approved while the sender is off (before go-live)
  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'rfp', v_r1, 'approved', 'Welcome aboard', true));
  v_j2 := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'consultation', v_c1, 'closed', null, false));
  perform pg_temp._dr_line('C07 sender off (before go-live): approved, the message kept in the history, nothing queued now or for later; an unticked box is logged as sender_off too',
    array[v_j ->> 'email', (select status from public.rfps where id = v_r1),
          (select l.note from public.review_log l where l.id = (v_j ->> 'review_log_id')::bigint),
          (select count(*)::text from public.notification_outbox where subject_id = v_r1),
          v_j2 ->> 'email',
          (select count(*)::text from public.notification_outbox where subject_id = v_c1)],
    array['sender_off', 'approved', 'Welcome aboard', '0', 'sender_off', '0']);

  -- The sender on (go-live)
  update public.platform_settings ps set value = ps.value || '{"outbox_sender": true}'::jsonb where ps.key = 'registration_flags';

  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'rfp', v_r1, 'rejected', '  DRYRUN reason  ', true));
  v_o1 := (v_j ->> 'outbox_id')::bigint;
  perform pg_temp._dr_line('C08 sender on: rejected with its reason; ONE e-mail queued for the requester, by this admin, keyed to this change; the reason stored for the site',
    array[v_j ->> 'email', (select rejection_reason from public.rfps where id = v_r1),
          (select count(*)::text from public.notification_outbox o where o.id = v_o1 and o.kind = 'market_request_status'
             and o.user_id = v_auth and o.actor_id = v_adm and o.subject_id = v_r1 and o.sent_at is null
             and o.dedupe_key = 'market_request_status:' || (v_j ->> 'review_log_id')
             and o.data = jsonb_build_object('request_kind', 'rfp', 'status', 'rejected', 'review_log_id', (v_j ->> 'review_log_id')::bigint)),
          (select (l.details ->> 'outbox_id') from public.review_log l where l.id = (v_j ->> 'review_log_id')::bigint),
          (select count(*)::text from public.notification_outbox where subject_id = v_r1)],
    array['queued', 'DRYRUN reason', '1', v_o1::text, '1']);

  v_j := pg_temp._dr_json('service_role', null, format(v_mail, v_o1));
  perform pg_temp._dr_line('C09 the sender (service_role) reads the e-mail words from the database; staff may not',
    array[v_j ->> 'ok', v_j ->> 'user_id', v_j ->> 'request_kind', v_j ->> 'status', v_j ->> 'title', v_j ->> 'message', v_j ->> 'request_id',
          split_part(pg_temp._dr_err('authenticated', v_adm, format(v_mail, v_o1)), ':', 1)],
    array['true', v_auth::text, 'rfp', 'rejected', 'DRYRUN rfp', 'DRYRUN reason', v_r1::text, '42501']);

  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'rfp', v_r1, 'closed', 'DRYRUN closing note', true));
  v_o2 := (v_j ->> 'outbox_id')::bigint;
  perform pg_temp._dr_line('C10 a newer change settles the e-mail that had not left (never sent) and queues its own; the old reason is cleared (members read rfps)',
    array[v_j ->> 'email', coalesce((select rejection_reason from public.rfps where id = v_r1), 'none'),
          (select o.last_error from public.notification_outbox o where o.id = v_o1),
          ((select o.sent_at from public.notification_outbox o where o.id = v_o1) is not null)::text,
          pg_temp._dr_json('service_role', null, format(v_mail, v_o1)) ->> 'sent',
          pg_temp._dr_json('service_role', null, format(v_mail, v_o2)) ->> 'status',
          pg_temp._dr_json('service_role', null, format(v_mail, v_o2)) ->> 'message',
          (select count(*)::text from public.notification_outbox where subject_id = v_r1 and sent_at is null)],
    array['queued', 'none', 'not sent: a newer status change replaced it', 'true', 'true', 'closed', 'DRYRUN closing note', '1']);

  -- The live site's old screen changes the status directly (its staff policy, untouched).
  -- (A write and a plain read never share one statement here: the read would see the
  -- statement's starting snapshot.)
  v_txt := pg_temp._dr_err('authenticated', v_adm, format('update public.rfps set status = %L where id = %L returning 1', 'archived', v_r1));
  perform pg_temp._dr_line('C11 main''s old screen still writes directly (staff policy); the e-mail queued before is then out of date',
    array[v_txt,
          (select status from public.rfps where id = v_r1),
          pg_temp._dr_json('service_role', null, format(v_mail, v_o2)) ->> 'stale',
          pg_temp._dr_json('service_role', null, format(v_mail, v_o2)) ->> 'why'],
    array['ok', 'archived', 'true', 'the status changed again before the e-mail left']);

  v_logs := (select count(*) from public.notification_outbox where subject_id = v_r1);
  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'rfp', v_r1, 'approved', 'not sent', false));
  perform pg_temp._dr_line('C12 "Tell them by e-mail" unticked: approved, no e-mail queued, the older one settled; no reason left on the published request',
    array[v_j ->> 'email', (select status from public.rfps where id = v_r1),
          coalesce((select rejection_reason from public.rfps where id = v_r1), 'none'),
          ((select count(*) from public.notification_outbox where subject_id = v_r1) - v_logs)::text,
          (select count(*)::text from public.notification_outbox where subject_id = v_r1 and sent_at is null)],
    array['not_asked', 'approved', 'none', '0', '0']);

  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'rfp', v_r1, 'closed', null, true));
  v_o3 := (v_j ->> 'outbox_id')::bigint;
  update public.notification_outbox set created_at = now() - interval '73 hours' where id = v_o3;
  perform pg_temp._dr_line('C13 an e-mail queued more than 72 hours ago is never sent late',
    array[v_j ->> 'email', pg_temp._dr_json('service_role', null, format(v_mail, v_o3)) ->> 'why'],
    array['queued', 'queued more than 72 hours ago: never sent late']);

  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'consultation', v_c1, 'approved', null, true));
  v_j2 := pg_temp._dr_json('service_role', null, format(v_mail, (v_j ->> 'outbox_id')::bigint));
  perform pg_temp._dr_line('C14 consultation approved: one e-mail to its requester, its own title, no message',
    array[v_j ->> 'email', v_j2 ->> 'ok', v_j2 ->> 'user_id', v_j2 ->> 'request_kind', v_j2 ->> 'title', coalesce(v_j2 ->> 'message', 'none')],
    array['queued', 'true', v_auth::text, 'consultation', 'DRYRUN consultation', 'none']);

  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'project', v_p1, 'in_progress', null, true));
  v_txt := pg_temp._dr_err('authenticated', v_adm, format(v_set, 'project', v_p1, 'rejected', null, true));
  v_j2 := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'project', v_p1, 'approved', null, true));
  v_t2 := pg_temp._dr_json('service_role', null, format(v_mail, (v_j2 ->> 'outbox_id')::bigint)) ->> 'title';
  v_t3 := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'project', v_p1, 'completed', null, true)) ->> 'email';
  perform pg_temp._dr_line('C15 marina project: in progress e-mails nobody; rejected needs a reason; approved and completed e-mail the requester ("Energy project")',
    array[v_j ->> 'email', v_txt, v_j2 ->> 'email', v_t2, v_t3,
          (select string_agg(o.data ->> 'status' || ':' || (o.sent_at is null)::text, ',' order by o.id) from public.notification_outbox o where o.subject_id = v_p1),
          (select status from public.marina_projects where id = v_p1)],
    array['not_for_this_status', '22023:reason_required', 'queued', 'Energy project', 'queued', 'approved:false,completed:true', 'completed']);

  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'lead', v_l1, 'qualified', 'called them', true));
  v_j2 := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'lead', v_l1, 'rejected', null, true));
  perform pg_temp._dr_line('C16 partner lead: status saved and logged, never an e-mail (no account), rejected needs no reason',
    array[v_j ->> 'email',
          v_j2 ->> 'email',
          (select status from public.partner_leads where id = v_l1),
          (select count(*)::text from public.review_log where subject_type = 'market_request' and subject_id = v_l1),
          (select count(*)::text from public.notification_outbox where subject_id = v_l1)],
    array['not_for_leads', 'not_for_leads', 'rejected', '2', '0']);

  if v_r2 is not null then
    v_j := pg_temp._dr_json('authenticated', v_adm, format(v_set, 'rfp', v_r2, 'approved', null, true));
    perform pg_temp._dr_line('C17 a suspended requester is never e-mailed',
      array[v_j ->> 'email', (select status from public.rfps where id = v_r2), (select count(*)::text from public.notification_outbox where subject_id = v_r2)],
      array['author_suspended', 'approved', '0']);
  else
    insert into _dr_res (ok, label) values (true, 'C17 a suspended requester is never e-mailed: skipped, no suspended account to use');
  end if;

  v_outs := (select count(*) from public.notification_outbox where subject_id = v_r1);
  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_edit, 'rfp', v_r1, '{"title": " DRYRUN rfp corrected ", "scope": "DRYRUN scope corrected", "deadline_date": "2026-12-15"}'));
  perform pg_temp._dr_line('C18 staff correct an RFP: saved, logged with the old and new text, never e-mailed',
    array[v_j ->> 'changed', (select title || '|' || scope || '|' || deadline_date::text from public.rfps where id = v_r1),
          (select l.details #>> '{fields,title,from}' || '>' || (l.details #>> '{fields,title,to}') || '|' || (l.details #>> '{fields,deadline_date,from}')
             from public.review_log l where l.id = (v_j ->> 'review_log_id')::bigint and l.action = 'request_edited' and l.actor_id = v_adm),
          ((select count(*) from public.notification_outbox where subject_id = v_r1) - v_outs)::text],
    array['3', 'DRYRUN rfp corrected|DRYRUN scope corrected|2026-12-15', 'DRYRUN rfp>DRYRUN rfp corrected|2026-12-01', '0']);

  v_logs := (select count(*) from public.review_log where subject_id = v_r1);
  perform pg_temp._dr_line('C19 the same text again changes nothing and logs nothing',
    array[pg_temp._dr_json('authenticated', v_adm, format(v_edit, 'rfp', v_r1, '{"title": "DRYRUN rfp corrected"}')) ->> 'changed',
          ((select count(*) from public.review_log where subject_id = v_r1) - v_logs)::text],
    array['0', '0']);

  perform pg_temp._dr_line('C20 corrections refused: the status, an empty title, a bad date, an impossible date, too long, a number, nothing, not staff',
    array[pg_temp._dr_err('authenticated', v_adm, format(v_edit, 'rfp', v_r1, '{"status": "approved"}')),
          pg_temp._dr_err('authenticated', v_adm, format(v_edit, 'rfp', v_r1, '{"title": "   "}')),
          pg_temp._dr_err('authenticated', v_adm, format(v_edit, 'rfp', v_r1, '{"deadline_date": "tomorrow"}')),
          pg_temp._dr_err('authenticated', v_adm, format(v_edit, 'rfp', v_r1, '{"deadline_date": "2026-02-30"}')),
          pg_temp._dr_err('authenticated', v_adm, format(v_edit, 'rfp', v_r1, jsonb_build_object('title', repeat('x', 201))::text)),
          pg_temp._dr_err('authenticated', v_adm, format(v_edit, 'rfp', v_r1, '{"title": 5}')),
          pg_temp._dr_err('authenticated', v_adm, format(v_edit, 'rfp', v_r1, '[]')),
          pg_temp._dr_err('authenticated', v_mem, format(v_edit, 'consultation', v_c1, '{"title": "x"}')),
          (select title from public.rfps where id = v_r1)],
    array['22023:field_not_editable', '22023:required_field', '22023:bad_date', '22023:bad_date', '22023:too_long', '22023:bad_value',
          '22023:nothing_to_change', '42501:forbidden', 'DRYRUN rfp corrected']);

  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_edit, 'lead', v_l1, '{"company": "DRYRUN Co Ltd", "email": "dryrun-lead2@example.invalid", "phone": ""}'));
  perform pg_temp._dr_line('C21 a partner lead corrected (an emptied phone stays empty); a bad address or engagement level refused',
    array[v_j ->> 'changed', (select company || '|' || email || '|' || coalesce(phone, 'none') from public.partner_leads where id = v_l1),
          pg_temp._dr_err('authenticated', v_adm, format(v_edit, 'lead', v_l1, '{"email": "not-an-address"}')),
          pg_temp._dr_err('authenticated', v_adm, format(v_edit, 'lead', v_l1, '{"engagement_level": "maybe"}'))],
    array['2', 'DRYRUN Co Ltd|dryrun-lead2@example.invalid|none', '22023:bad_email', '22023:bad_value']);

  v_j := pg_temp._dr_json('authenticated', v_adm, format(v_note, 'consultation', v_c1, ' Called the harbour master '));
  perform pg_temp._dr_line('C22 internal notes: staff add one (review_log only); empty, unknown request and non-staff refused',
    array[v_j ->> 'ok',
          (select l.note || '|' || l.action from public.review_log l where l.id = (v_j ->> 'review_log_id')::bigint and l.subject_id = v_c1),
          pg_temp._dr_err('authenticated', v_adm, format(v_note, 'consultation', v_c1, '  ')),
          pg_temp._dr_err('authenticated', v_adm, format(v_note, 'consultation', gen_random_uuid(), 'x')),
          pg_temp._dr_err('authenticated', v_mem, format(v_note, 'consultation', v_c1, 'x'))],
    array['true', 'Called the harbour master|request_note', '22023:note_required', 'P0002:not_found', '42501:forbidden']);

  perform pg_temp._dr_line('C23 the requester reads their request but neither its history nor its e-mails; staff read both',
    array[pg_temp._dr_json('authenticated', v_auth, format('select count(*) from public.rfps where id = %L', v_r1))::text,
          pg_temp._dr_json('authenticated', v_auth, format('select count(*) from public.review_log where subject_id = %L', v_r1))::text,
          pg_temp._dr_json('authenticated', v_auth, format('select count(*) from public.notification_outbox where subject_id = %L', v_r1))::text,
          (pg_temp._dr_json('authenticated', v_adm, format('select count(*) from public.review_log where subject_id = %L', v_r1))::text::int > 5)::text,
          (pg_temp._dr_json('authenticated', v_adm, format('select count(*) from public.notification_outbox where subject_id = %L', v_r1))::text::int > 2)::text],
    array['1', '0', '0', 'true', 'true']);

  if v_auth_marina then
    v_txt := pg_temp._dr_err('authenticated', v_auth, format('update public.rfps set scope = %L, status = %L where id = %L returning 1', 'DRYRUN own edit', 'submitted', v_r1));
    perform pg_temp._dr_line('C24 the requester''s own edit on the site still works, and still cannot change the status (existing guard)',
      array[v_txt,
            (select scope || '|' || status from public.rfps where id = v_r1)],
      array['ok', 'DRYRUN own edit|closed']);
  else
    insert into _dr_res (ok, label) values (true, 'C24 the requester''s own edit: skipped, no verified marina account to use');
  end if;
end
$c$;

-- D. The down, verbatim
-- DOWN of supabase/migrations/20261021175000_market_requests.sql.
-- Removes what it added: the eight functions, the queued or sent status e-mails of
-- notification_outbox (kind 'market_request_status') and the history of the marina requests in
-- review_log (subject_type 'market_request': status changes, corrections and notes are lost;
-- export them first if they matter), then puts both lists back as they were. The statuses and the
-- corrected texts of the requests themselves stay as they are now.
-- Refused while another SQL function still names one of the functions it drops, or while another
-- file has widened one of the two lists since (merge the lists first).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
  v_def text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.prosrc ilike '%market_request_%' or p.prosrc ilike '%admin_market_request%')
     and p.proname not in (
       'market_request_statuses', 'market_request_mails', 'market_request_emails_on', 'market_request_row',
       'admin_market_request_set_status', 'admin_market_request_edit', 'admin_market_request_note', 'market_request_email');
  if v_bad is not null then
    raise exception 'market_requests down: other SQL function(s) use these functions: %', v_bad;
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass;
  if v_def is distinct from 'CHECK ((kind = ANY (ARRAY[''account_under_review''::text, ''team_join_request''::text, ''user_account_approved''::text, ''user_account_rejected''::text, ''account_info_requested''::text, ''company_validated''::text, ''claim_approved''::text, ''claim_declined''::text, ''comment_mention''::text, ''comment_report''::text, ''market_request_status''::text])))' then
    raise exception 'market_requests down: notification_outbox kinds changed since (%); merge the lists in this file', v_def;
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'review_log_subject_type_check' and c.conrelid = 'public.review_log'::regclass;
  if v_def is distinct from 'CHECK ((subject_type = ANY (ARRAY[''person''::text, ''company''::text, ''registration''::text, ''claim''::text, ''join''::text, ''merge''::text, ''market_request''::text])))' then
    raise exception 'market_requests down: review_log subject types changed since (%); merge the lists in this file', v_def;
  end if;
end
$pre$;

drop function if exists
  public.market_request_email(bigint),
  public.admin_market_request_note(text, uuid, text),
  public.admin_market_request_edit(text, uuid, jsonb),
  public.admin_market_request_set_status(text, uuid, text, text, boolean),
  public.market_request_row(text, uuid),
  public.market_request_emails_on(),
  public.market_request_mails(text, text),
  public.market_request_statuses(text);

delete from public.notification_outbox o where o.kind = 'market_request_status';
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'account_under_review', 'team_join_request',
  'user_account_approved', 'user_account_rejected', 'account_info_requested', 'company_validated',
  'claim_approved', 'claim_declined',
  'comment_mention', 'comment_report'));

delete from public.review_log l where l.subject_type = 'market_request';
alter table public.review_log drop constraint review_log_subject_type_check;
alter table public.review_log add constraint review_log_subject_type_check check (subject_type in (
  'person', 'company', 'registration', 'claim', 'join', 'merge'));

-- E. After the down, and the verdict
do $z$
declare
  v_adm uuid := (select u from _dr_fx where k = 'adm');
  v_r1 uuid := (select u from _dr_fx where k = 'r1');
  v_txt text;
  v_pass int;
  v_fail int;
  v_all text;
begin
  perform pg_temp._dr_line('E1 after the down: no function left, both lists as before, the history and e-mails of the requests gone, every other row kept',
    array[(select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('market_request_statuses', 'market_request_mails', 'market_request_emails_on', 'market_request_row',
                               'admin_market_request_set_status', 'admin_market_request_edit', 'admin_market_request_note', 'market_request_email')),
          ((select pg_get_constraintdef(c.oid) from pg_constraint c
             where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass)
            = (select t from _dr_fx where k = 'kinds_def'))::text,
          ((select pg_get_constraintdef(c.oid) from pg_constraint c
             where c.conname = 'review_log_subject_type_check' and c.conrelid = 'public.review_log'::regclass)
            = (select t from _dr_fx where k = 'types_def'))::text,
          (select count(*)::text from public.review_log),
          (select count(*)::text from public.notification_outbox)],
    array['0', 'true', 'true', (select t from _dr_fx where k = 'log_total'), (select t from _dr_fx where k = 'outbox_total')]);

  v_txt := pg_temp._dr_err('authenticated', v_adm, format('update public.rfps set status = %L where id = %L returning 1', 'under_review', v_r1));
  perform pg_temp._dr_line('E2 the requests keep their status and text; main''s old screens still write directly',
    array[v_txt, (select status || '|' || title from public.rfps where id = v_r1)],
    array['ok', 'under_review|DRYRUN rfp corrected']);

  select count(*) filter (where ok), count(*) filter (where not ok),
         string_agg(case when ok then 'PASS ' else 'FAIL ' end || label, E'\n' order by n)
    into v_pass, v_fail, v_all
    from pg_temp._dr_res;
  raise exception 'DRYRUN % PASS, % FAIL%', v_pass, v_fail, E'\n' || v_all;
end
$z$;
