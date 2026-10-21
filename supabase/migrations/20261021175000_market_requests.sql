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
