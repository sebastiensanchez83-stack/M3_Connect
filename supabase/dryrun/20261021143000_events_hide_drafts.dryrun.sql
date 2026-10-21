-- DRY RUN of supabase/migrations/20261021143000_events_hide_drafts.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A snapshot, the migration verbatim, four fixture events (a public draft, a public event whose
-- published is null, a published public event, a members-only draft: inserted in this transaction
-- only), cases as anon, a validated member and M3 staff, then the down verbatim and checks again.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "13 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_pol on commit drop as
  select pl.schemaname::text as s, pl.tablename::text as t, pl.policyname::text as p, pl.roles::text as r, pl.cmd as c,
         coalesce(pl.qual, '') as q, coalesce(pl.with_check, '') as w
    from pg_policies pl where pl.schemaname in ('public', 'storage');

-- Runs one query (one text column) as anon or as a signed-in account and returns 'ok:<value>' or
-- 'err:<sqlstate>:<message>'. The error is caught around the query only; the caller asserts after.
create function pg_temp.dr_as(p_who text, p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  if p_who = 'anon' then
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    set local role anon;
  elsif p_who = 'authenticated' then
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  else
    raise exception 'dr_as: unknown caller %', p_who;
  end if;
  begin
    execute p_sql into v_out;
    v_out := 'ok:' || coalesce(v_out, 'null');
  exception when others then
    v_out := 'err:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end
$f$;

-- B. The migration, verbatim
-- Draft events are no longer readable by their address (go-live runbook P2 item 5; Victor, 21 Oct
-- 2026, Q10 = a: "corriges tout de suite").
-- Down: supabase/migrations/down/20261021143000_events_hide_drafts.down.sql
-- Dry run: supabase/dryrun/20261021143000_events_hide_drafts.dryrun.sql (this file, cases as anon,
-- a validated member and M3 staff on a draft, then the down, in one rolled-back transaction).
--
-- SAFE FOR MAIN. Two policies of public.events get the "published" condition; nothing else changes.
--   - Today events_anon_public (anon) and events_select_by_access_level (authenticated, outside its
--     is_moderator() branch) do not look at events.published: anyone who knows the id or the slug
--     of a draft reads it through the API (the 4 events of 21 Oct 2026 are all published, so
--     nothing leaks today; the next draft, SM27 for instance, would).
--   - "Published" is `published is not false`, the rule both clients and the sitemap already use
--     (`.not('published', 'is', false)`, `published=not.is.false`): the column defaults to true
--     and a null counts as published. Staff (public.is_moderator()) still read every draft.
--   - Both clients already hide a draft on screen from everyone but staff (main and refonte
--     EventsPage / EventDetailPage), so no screen changes. The functions that read events are all
--     SECURITY DEFINER (event_slug_lookup already skips drafts, admin_save_event, my_participations,
--     public_registration_events, get_my_event_access...) and are not affected by policies.
--   - NOT here: the webinar meeting link (events.meeting_url) stays readable signed out until
--     go-live, because main reads events with select('*'); its revoke is in
--     held/directory_visitor_basic.sql.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = 'events' and p.policyname = 'events_anon_public'
                    and p.roles = '{anon}'::name[] and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
                    and p.qual = '(lower(COALESCE(access_level, ''public''::text)) = ''public''::text)') then
    raise exception 'events_hide_drafts: events_anon_public is not as on 21 Oct 2026 (applied already?); rebuild this file';
  end if;
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = 'events' and p.policyname = 'events_select_by_access_level'
                    and p.roles = '{authenticated}'::name[] and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
                    and p.qual = '(is_moderator() OR can_access_resource(access_level))') then
    raise exception 'events_hide_drafts: events_select_by_access_level is not as on 21 Oct 2026 (applied already?); rebuild this file';
  end if;
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'events' and c.column_name = 'published' and c.data_type = 'boolean') then
    raise exception 'events_hide_drafts: events.published (boolean) is missing';
  end if;
end
$pre$;

alter policy events_anon_public on public.events
  using (lower(coalesce(access_level, 'public')) = 'public' and published is not false);

alter policy events_select_by_access_level on public.events
  using (public.is_moderator() or (published is not false and public.can_access_resource(access_level)));

-- C. Fixtures (this transaction only) and checks
create temp table _dr_ev on commit drop as
  select gen_random_uuid() as e1, gen_random_uuid() as e2, gen_random_uuid() as e3, gen_random_uuid() as e4,
         substr(md5(random()::text), 1, 8) as r8;

do $fx$
declare
  v record;
begin
  select * into v from _dr_ev;
  insert into public.events (id, title, slug, slug_auto, access_level, event_type, published, date_time)
  values (v.e1, 'Dryrun draft ' || v.r8, 'dryrun-draft-' || v.r8, false, 'public', 'webinar', false, now() + interval '30 days'),
         (v.e2, 'Dryrun null ' || v.r8, 'dryrun-null-' || v.r8, false, 'public', 'webinar', null, now() + interval '30 days'),
         (v.e3, 'Dryrun live ' || v.r8, 'dryrun-live-' || v.r8, false, 'public', 'webinar', true, now() + interval '30 days'),
         (v.e4, 'Dryrun members draft ' || v.r8, 'dryrun-mdraft-' || v.r8, false, 'members', 'webinar', false, now() + interval '30 days');
end
$fx$;

do $c$
declare
  v record;
  v_member uuid;
  v_staff uuid;
  v_out text;
  v_expect bigint;
  v_cols constant text := 'id, title, description, date_time, end_date_time, is_full_day, location, language, access_level, event_type, invitation_only, published, speakers, replay_url, pdf_url, brochure_url, event_website_url, event_partners, location_details, fees, max_attendance, created_at, image_url, slug';
begin
  select * into v from _dr_ev;
  select p.user_id into v_member from public.profiles p
   where p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator') order by p.user_id limit 1;
  select p.user_id into v_staff from public.profiles p
   where p.access_status = 'verified' and p.persona::text in ('admin', 'moderator') order by p.user_id limit 1;

  -- C1 the two policies
  insert into _dr_res (ok, label) values (
    exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'events' and p.policyname = 'events_anon_public'
             and p.roles = '{anon}'::name[] and p.cmd = 'SELECT'
             and p.qual = '((lower(COALESCE(access_level, ''public''::text)) = ''public''::text) AND (published IS NOT FALSE))')
      and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'events' and p.policyname = 'events_select_by_access_level'
                   and p.roles = '{authenticated}'::name[] and p.cmd = 'SELECT'
                   and p.qual = '(is_moderator() OR ((published IS NOT FALSE) AND can_access_resource(access_level)))'),
    'C1 events_anon_public and events_select_by_access_level carry "published is not false" (staff branch untouched)');

  -- C2 a visitor: the draft is not readable by its id, nor by its slug
  v_out := pg_temp.dr_as('anon', null, format('select count(*)::text from public.events where id = %L or slug = %L', v.e1, 'dryrun-draft-' || v.r8));
  insert into _dr_res (ok, label) values (v_out = 'ok:0', 'C2 anon: a public draft, by id or slug -> ' || v_out || ' row(s)');

  -- C3 a visitor: published true, and published null, are readable
  v_out := pg_temp.dr_as('anon', null, format('select count(*)::text from public.events where id in (%L, %L)', v.e2, v.e3));
  insert into _dr_res (ok, label) values (v_out = 'ok:2', 'C3 anon: published = true and published = null -> ' || v_out || ' row(s)');

  -- C4 a visitor: the event page's own column list on a published event (nothing refused)
  v_out := pg_temp.dr_as('anon', null, format('select count(*)::text from (select %s from public.events where id = %L) x', v_cols, v.e3));
  insert into _dr_res (ok, label) values (v_out = 'ok:1', 'C4 anon: the event page columns of a published event -> ' || v_out);

  -- C5 a visitor still reads every published public event
  select count(*) into v_expect from public.events e
   where lower(coalesce(e.access_level, 'public')) = 'public' and e.published is not false;
  v_out := pg_temp.dr_as('anon', null, 'select count(*)::text from public.events');
  insert into _dr_res (ok, label) values (v_out = 'ok:' || v_expect, 'C5 anon: every published public event (' || v_expect || ') -> ' || v_out);

  -- C6 a validated member: no draft at all
  v_out := pg_temp.dr_as('authenticated', v_member, format('select count(*)::text from public.events where id in (%L, %L)', v.e1, v.e4));
  insert into _dr_res (ok, label) values (v_member is not null and v_out = 'ok:0', 'C6 validated member: the public and the members-only drafts -> ' || v_out);

  -- C7 a validated member: the published ones as before
  v_out := pg_temp.dr_as('authenticated', v_member, format('select count(*)::text from public.events where id in (%L, %L)', v.e2, v.e3));
  insert into _dr_res (ok, label) values (v_out = 'ok:2', 'C7 validated member: published = null and true -> ' || v_out);

  -- C8 M3 staff: every draft
  v_out := pg_temp.dr_as('authenticated', v_staff, format('select count(*)::text from public.events where id in (%L, %L, %L, %L)', v.e1, v.e2, v.e3, v.e4));
  insert into _dr_res (ok, label) values (v_staff is not null and v_out = 'ok:4', 'C8 M3 staff: the 4 fixture events, drafts included -> ' || v_out);

  -- C9 the sitemap's read (published=not.is.false), signed out, finds no draft
  v_out := pg_temp.dr_as('anon', null, format('select count(*)::text from public.events where published is not false and id in (%L, %L)', v.e1, v.e4));
  insert into _dr_res (ok, label) values (v_out = 'ok:0', 'C9 anon: the sitemap filter on the drafts -> ' || v_out);

  -- C10 nothing else moved
  insert into _dr_res (ok, label) values (
    not exists ((select s.s, s.t, s.p, s.r, s.c, s.q, s.w from _dr_pol s where not (s.t = 'events' and s.p in ('events_anon_public', 'events_select_by_access_level')))
                except
                (select pl.schemaname::text, pl.tablename::text, pl.policyname::text, pl.roles::text, pl.cmd, coalesce(pl.qual, ''), coalesce(pl.with_check, '')
                   from pg_policies pl where pl.schemaname in ('public', 'storage')))
      and (select count(*) from pg_policies pl where pl.schemaname in ('public', 'storage')) = (select count(*) from _dr_pol),
    'C10 every other policy unchanged');
end
$c$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021143000_events_hide_drafts.sql
-- The two events policies read as on 21 Oct 2026 again: a draft is readable by its address by
-- anyone (anon: public access level; signed in: per can_access_resource). Harmless for both clients.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter policy events_anon_public on public.events
  using (lower(coalesce(access_level, 'public')) = 'public');

alter policy events_select_by_access_level on public.events
  using (public.is_moderator() or public.can_access_resource(access_level));

-- E. Checks after the down, then the report (rolls everything back)
do $e$
declare
  v_txt text;
  v_out text;
  v record;
begin
  select * into v from _dr_ev;
  insert into _dr_res (ok, label) values (
    exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'events' and p.policyname = 'events_anon_public'
             and p.qual = '(lower(COALESCE(access_level, ''public''::text)) = ''public''::text)')
      and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'events' and p.policyname = 'events_select_by_access_level'
                   and p.qual = '(is_moderator() OR can_access_resource(access_level))'),
    'E1 down: both policies read as on 21 Oct 2026');
  v_out := pg_temp.dr_as('anon', null, format('select count(*)::text from public.events where id = %L', v.e1));
  insert into _dr_res (ok, label) values (v_out = 'ok:1', 'E2 down: anon reads the public draft again (as before) -> ' || v_out);
  insert into _dr_res (ok, label) values (
    not exists ((select s.s, s.t, s.p, s.r, s.c, s.q, s.w from _dr_pol s)
                except
                (select pl.schemaname::text, pl.tablename::text, pl.policyname::text, pl.roles::text, pl.cmd, coalesce(pl.qual, ''), coalesce(pl.with_check, '')
                   from pg_policies pl where pl.schemaname in ('public', 'storage')))
      and not exists ((select pl.schemaname::text, pl.tablename::text, pl.policyname::text, pl.roles::text, pl.cmd, coalesce(pl.qual, ''), coalesce(pl.with_check, '')
                         from pg_policies pl where pl.schemaname in ('public', 'storage'))
                      except
                      (select s.s, s.t, s.p, s.r, s.c, s.q, s.w from _dr_pol s)),
    'E3 every policy back to the snapshot');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (events_hide_drafts, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
