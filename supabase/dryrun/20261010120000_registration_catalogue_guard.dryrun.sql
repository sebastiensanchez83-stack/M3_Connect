-- DRY RUN of supabase/migrations/20261010120000_registration_catalogue_guard.sql
-- NOTHING IS KEPT.
--
-- Run it only once 20261009210000_registration_core is applied (the guard reads gl_event.engine).
-- How to run: the WHOLE file in ONE execute_sql call (one implicit transaction).
-- Do not add BEGIN/COMMIT and do not run it statement by statement. The last
-- statement ends with RAISE EXCEPTION 'DRYRUN ...', so the migration and every
-- test write roll back; the error text IS the report ("n PASS, m FAIL" first,
-- then one line per check). Afterwards, check that nothing persisted:
--   select count(*) from pg_trigger where tgname like 'events_core_v2_%';     -> 0
--   select count(*) from gl_event where slug like 'dryrun-guard-%';           -> 0
--   select count(*) from events where title like 'Dry run guard %';           -> 0
--
-- Layout (same harness as the registration_core dry run)
--   A. snapshot before the body;
--   B. the migration body, verbatim;
--   C. one DO block: three test events made as postgres (a core_v2 draft without
--      registrations, a core_v2 event with one registration, an old-style event), then
--      structural checks (S..) and cases (G..). Each case runs in its own
--      sub-transaction as the simulated caller (set local role anon/authenticated/
--      service_role + request.jwt.claims), records its outcome, and is rolled back
--      before the next case starts.
--      Expectations: allow = no error (and >= 1 row written for a write);
--      rls = SQLSTATE 42501, or 0 rows written; err:<text> = an error containing <text>.
--      chk = an extra query run as postgres after the case's statement, inside the
--      case, that must return true.
--
-- Callers: looked up at run time (no personal data in this file): the oldest verified
-- admin (staff).
-- Locks: CREATE TRIGGER takes a SHARE ROW EXCLUSIVE lock on public.events until the end
-- (a few seconds): event pages wait behind it. Run it at a quiet moment. lock_timeout 5 s:
-- "canceling statement due to lock timeout" = nothing was kept; run it again later.
-- Expected result: "13 PASS, 0 FAIL" (5 structural checks, 8 cases).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot ─────────────────────────────────────────────────────────────
create temp table _dryrun_guard_before on commit drop as
  select (select count(*) from public.gl_event) as gl_events,
         (select count(*) from public.events) as events,
         (select md5(coalesce(string_agg(e.id::text || '|' || coalesce(e.meeting_url, ''), ',' order by e.id), '')) from public.events e) as meeting_fp;

-- ─── B. The migration body (verbatim) ────────────────────────────────────────
-- Registration core: the old event editor can no longer leak a join link or orphan an event.
-- 10 Oct 2026, integration of the unified-registration Phase 1 (branch rf-reg).
--
-- NOT APPLIED. Apply AFTER 20261009210000_registration_core (it reads gl_event.engine).
-- Dry run: supabase/dryrun/20261010120000_registration_catalogue_guard.dryrun.sql
-- Undo:    supabase/migrations/down/20261010120000_registration_catalogue_guard.down.sql
--
-- Why
--   A core_v2 event (made in the new event editor) has a row in public.events (its
--   catalogue page) and a row in public.gl_event (how people register). The join link of a
--   webinar lives in gl_event.meeting_url only: events.meeting_url is readable through the
--   API by anyone (policy events_anon_public, no "published" filter), drafts included.
--   The OLD event editor (AdminEventDetail, still live on main, and kept on the redesign for
--   the other events) writes events.meeting_url on save and deletes events rows. On a core_v2
--   event that would
--     * publish the join link to anyone who reads the events table, and
--     * delete the catalogue row: gl_event.legacy_event_id becomes NULL (ON DELETE SET NULL),
--       and the orphan registration keeps taking registrations through its link.
--   The redesign routes core_v2 events to the new editor; main cannot be changed. So the
--   rule is held at the table.
--
-- What it adds (two triggers on public.events, nothing else)
--   events_core_v2_meeting_url  BEFORE UPDATE OF meeting_url: on a core_v2 event the
--                               value is forced to NULL (no error: the old editor's save
--                               still goes through). admin_save_event already writes NULL.
--   events_core_v2_delete       BEFORE DELETE: a core_v2 event that has registrations
--                               (any gl_guest row) cannot be deleted (SQLSTATE 23514,
--                               message starts "events_core_v2_delete"). Without
--                               registrations, its gl_event row (and its participation
--                               types and questions, ON DELETE CASCADE) goes with it, so
--                               nothing is left orphaned.
--   Both functions are SECURITY DEFINER (gl_event and gl_guest are staff-only under RLS)
--   and read gl_event.engine through to_jsonb(), so they keep working (and do nothing)
--   if the registration core is ever undone before this file's undo.
--
-- Safety
--   Additive. No core_v2 event exists today except the hidden canary-v2, which has no
--   catalogue row: both triggers change nothing for any existing event, for the old live
--   client or for the guest list (wys26 is guest_list_v1). No sm_* row, no gl_guest token,
--   no policy or grant changes.
--
-- Checks after applying (read-only)
--   select tgname from pg_trigger where tgrelid = 'public.events'::regclass and not tgisinternal order by 1;
--     -> events_core_v2_delete, events_core_v2_meeting_url, events_publish_guard

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'gl_event' and column_name = 'engine') then
    raise exception 'registration_catalogue_guard: apply 20261009210000_registration_core first (gl_event.engine is missing)';
  end if;
end
$pre$;

-- The join link of a core_v2 event never goes into its public catalogue row.
create or replace function public.events_core_v2_meeting_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (select 1 from public.gl_event g
              where g.legacy_event_id = new.id
                and to_jsonb(g) ->> 'engine' = 'core_v2') then
    new.meeting_url := null;
  end if;
  return new;
end
$function$;

drop trigger if exists events_core_v2_meeting_url on public.events;
create trigger events_core_v2_meeting_url
  before update of meeting_url on public.events
  for each row
  when (new.meeting_url is not null)
  execute function public.events_core_v2_meeting_url();

-- A core_v2 event is deleted with its registration settings, never left orphaned, and
-- never while people are registered.
create or replace function public.events_core_v2_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_gl uuid;
begin
  select g.id into v_gl
    from public.gl_event g
   where g.legacy_event_id = old.id
     and to_jsonb(g) ->> 'engine' = 'core_v2';
  if v_gl is null then
    return old;
  end if;
  if exists (select 1 from public.gl_guest x where x.event_id = v_gl) then
    raise exception using errcode = '23514',
      message = 'events_core_v2_delete: people are registered for this event, so it cannot be deleted',
      hint = 'Unpublish it instead, or ask the developer.';
  end if;
  delete from public.gl_event g where g.id = v_gl;
  return old;
end
$function$;

drop trigger if exists events_core_v2_delete on public.events;
create trigger events_core_v2_delete
  before delete on public.events
  for each row
  execute function public.events_core_v2_delete();

-- Trigger functions only: nobody calls them directly.
revoke all on function public.events_core_v2_meeting_url() from public, anon, authenticated;
revoke all on function public.events_core_v2_delete() from public, anon, authenticated;

comment on function public.events_core_v2_meeting_url() is
  'events trigger (registration_catalogue_guard): a core_v2 event keeps its join link in gl_event.meeting_url only; events.meeting_url is forced to NULL.';
comment on function public.events_core_v2_delete() is
  'events trigger (registration_catalogue_guard): deleting a core_v2 catalogue row also deletes its gl_event; refused (23514) while any gl_guest row exists.';

-- ─── C. Checks and cases ────────────────────────────────────────────────────
do $dryrun$
declare
  results text := '';
  n_pass integer := 0;
  n_fail integer := 0;
  c_staff uuid;
  ev_a uuid;   -- core_v2 draft, no registration
  ev_b uuid;   -- core_v2, one registration
  ev_l uuid;   -- old-style event (no gl_event)
  gl_a uuid;
  gl_b uuid;
  r record;
  tests jsonb;
  t jsonb;
  v_dml boolean;
  v_ret text;
  v_n bigint;
  v_err text;
  v_state text;
  v_chk boolean;
  v_exp text;
  v_pass boolean;
begin
  select p.user_id into c_staff from public.profiles p
   where p.persona = 'admin' and p.access_status = 'verified' order by p.created_at limit 1;
  if c_staff is null then
    results := results || E'\nFAIL LOOKUP no verified admin';
    n_fail := n_fail + 1;
  end if;

  -- Test events (as postgres; rolled back with everything else).
  insert into public.events (title, event_type, published, access_level)
  values ('Dry run guard A', 'webinar', false, 'public') returning id into ev_a;
  insert into public.events (title, event_type, published, access_level)
  values ('Dry run guard B', 'webinar', false, 'public') returning id into ev_b;
  insert into public.events (title, event_type, published, access_level)
  values ('Dry run guard L', 'webinar', false, 'public') returning id into ev_l;
  insert into public.gl_event (slug, title, legacy_event_id, engine, kind, registration_mode, door_token, requests_open, hidden)
  values ('dryrun-guard-a', 'Dry run guard A', ev_a, 'core_v2', 'webinar', 'instant', 'separate', false, true) returning id into gl_a;
  insert into public.gl_event (slug, title, legacy_event_id, engine, kind, registration_mode, door_token, requests_open, hidden)
  values ('dryrun-guard-b', 'Dry run guard B', ev_b, 'core_v2', 'webinar', 'instant', 'separate', false, true) returning id into gl_b;
  insert into public.gl_question (event_id, key, label, kind) values (gl_a, 'dryrun_q', 'Dry run question', 'text');
  insert into public.gl_guest (event_id, source, status, first_name, last_name, email)
  values (gl_b, 'registration', 'requested', 'Dry', 'Run', 'dryrun.guard@example.com');

  -- ── Structural checks ──
  create temp table _dr_checks (id text, ok boolean, label text) on commit drop;
  insert into _dr_checks values
    ('S01', (select count(*) = 2 from pg_trigger
              where tgrelid = 'public.events'::regclass and not tgisinternal
                and tgname in ('events_core_v2_meeting_url', 'events_core_v2_delete')),
     'two triggers on public.events'),
    ('S02', (select bool_and(p.prosecdef) and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
                    and bool_and(not has_function_privilege('authenticated', p.oid, 'execute'))
               from pg_proc p
              where p.oid in ('public.events_core_v2_meeting_url()'::regprocedure, 'public.events_core_v2_delete()'::regprocedure)),
     'both functions SECURITY DEFINER, not executable by anon or authenticated'),
    ('S03', (select b.gl_events = (select count(*) from public.gl_event) - 2
                    and b.events = (select count(*) from public.events) - 3
               from _dryrun_guard_before b),
     'the body wrote no row (only the 2 + 3 test rows are new)'),
    ('S04', (select b.meeting_fp = (select md5(coalesce(string_agg(e.id::text || '|' || coalesce(e.meeting_url, ''), ',' order by e.id), ''))
                                      from public.events e where e.id not in (ev_a, ev_b, ev_l))
               from _dryrun_guard_before b),
     'no existing join link changed'),
    ('S05', not exists (select 1 from public.gl_event g
                          join public.events e on e.id = g.legacy_event_id
                         where to_jsonb(g) ->> 'engine' = 'core_v2' and e.meeting_url is not null
                           and g.slug not like 'dryrun-guard-%'),
     'no existing core_v2 event has a join link in its catalogue row');
  for r in select * from _dr_checks order by id loop
    if coalesce(r.ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s', case when coalesce(r.ok, false) then 'PASS' else 'FAIL' end, r.id, r.label);
  end loop;

  -- ── Cases ──
  tests := jsonb_build_array(
    jsonb_build_object('id', 'G01', 'who', 'staff', 'expect', 'allow',
      'label', 'the old editor saves a join link on a core_v2 event: saved without it',
      'q', format('update public.events set meeting_url = %L, title = %L where id = %L', 'https://meet.example.com/j/1', 'Dry run guard A2', ev_a),
      'chk', format('select meeting_url is null and title = %L from public.events where id = %L', 'Dry run guard A2', ev_a)),
    jsonb_build_object('id', 'G02', 'who', 'staff', 'expect', 'allow',
      'label', 'an old-style webinar keeps its join link (unchanged behaviour)',
      'q', format('update public.events set meeting_url = %L where id = %L', 'https://meet.example.com/j/2', ev_l),
      'chk', format('select meeting_url = %L from public.events where id = %L', 'https://meet.example.com/j/2', ev_l)),
    jsonb_build_object('id', 'G03', 'who', 'service', 'expect', 'allow',
      'label', 'the service role cannot put a join link in a core_v2 catalogue row either',
      'q', format('update public.events set meeting_url = %L where id = %L', 'https://meet.example.com/j/3', ev_b),
      'chk', format('select meeting_url is null from public.events where id = %L', ev_b)),
    jsonb_build_object('id', 'G04', 'who', 'staff', 'expect', 'allow',
      'label', 'deleting a core_v2 draft without registrations also deletes its gl_event and questions',
      'q', format('delete from public.events where id = %L', ev_a),
      'chk', format('select not exists (select 1 from public.gl_event where id = %1$L)
                       and not exists (select 1 from public.gl_question where event_id = %1$L)', gl_a)),
    jsonb_build_object('id', 'G05', 'who', 'staff', 'expect', 'err:events_core_v2_delete',
      'label', 'a core_v2 event with a registration cannot be deleted',
      'q', format('delete from public.events where id = %L', ev_b)),
    jsonb_build_object('id', 'G06', 'who', 'staff', 'expect', 'allow',
      'label', 'an old-style event is deleted as before',
      'q', format('delete from public.events where id = %L', ev_l),
      'chk', format('select not exists (select 1 from public.events where id = %L)', ev_l)),
    jsonb_build_object('id', 'G07', 'who', 'anon', 'expect', 'rls',
      'label', 'anon still cannot delete events',
      'q', format('delete from public.events where id = %L', ev_a)),
    jsonb_build_object('id', 'G08', 'who', 'staff', 'expect', 'allow',
      'label', 'a core_v2 event is still edited (title) and keeps its gl_event',
      'q', format('update public.events set title = %L where id = %L', 'Dry run guard B2', ev_b),
      'chk', format('select exists (select 1 from public.gl_event where id = %L and legacy_event_id = %L)', gl_b, ev_b))
  );

  for t in select * from jsonb_array_elements(tests) loop
    v_dml := lower(left(ltrim(t ->> 'q'), 6)) in ('insert', 'update', 'delete');
    v_ret := null; v_n := null; v_err := null; v_state := null; v_chk := null;
    begin
      perform set_config('request.jwt.claim.sub', '', true);
      if t ->> 'who' = 'anon' then
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        set local role anon;
      elsif t ->> 'who' = 'service' then
        perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
        set local role service_role;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', c_staff, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      if v_dml then
        execute t ->> 'q';
        get diagnostics v_n = row_count;
      else
        execute t ->> 'q' into v_ret;
      end if;
      reset role;
      if coalesce(t ->> 'chk', '') <> '' then
        execute t ->> 'chk' into v_chk;
      end if;
      raise exception using errcode = 'DRY01', message = 'case finished';
    exception
      when sqlstate 'DRY01' then null;
      when others then v_err := sqlerrm; v_state := sqlstate;
    end;

    v_exp := t ->> 'expect';
    v_pass := coalesce(case
                when v_exp = 'allow' then v_err is null and (not v_dml or v_n > 0)
                when v_exp = 'rls'   then v_state = '42501' or (v_err is null and v_dml and v_n = 0)
                when v_exp like 'err:%' then strpos(v_err, substr(v_exp, 5)) > 0
              end, false)
              and (coalesce(t ->> 'chk', '') = '' or v_chk is true);
    if v_pass then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s %s: %s | expect %s | %s%s',
      case when v_pass then 'PASS' else 'FAIL' end, t ->> 'id', t ->> 'who', t ->> 'label', v_exp,
      left(case when v_err is not null then format('error %s: %s', v_state, v_err)
                when v_dml then v_n || ' row(s) written'
                else 'returned ' || coalesce(v_ret, 'null') end, 300),
      case when coalesce(t ->> 'chk', '') <> '' then ' | chk ' || coalesce(v_chk::text, 'null') else '' end);
  end loop;

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (registration_catalogue_guard, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
