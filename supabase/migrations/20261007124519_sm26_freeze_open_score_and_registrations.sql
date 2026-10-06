-- SM26 is over (20-21 Sep 2026): close the paths that still write into it.
-- Audit items S17 and S9 (Phase 0, security). The edge-function half of S9
-- (sm26-register, sm26-draft) and S20 (sm26-attendee-invite) ship as code in the
-- same change and depend on sm_registrations_open() defined here.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What was wrong (verified on production, 6-7 Oct 2026)
-- ════════════════════════════════════════════════════════════════════════════
-- S17  /sm26/score. sm_open_score_submit (SECURITY DEFINER, EXECUTE granted to
--      anon) writes sm_open_score, sm_jury_assignment, sm_review and
--      sm_criterion_score with no closing check. Its only gate is a shared code
--      kept in sm_event.settings.open_score_code, and sm_event is readable by
--      anon (policy sm_event_read = true, table-level SELECT, settings included).
--      So anyone could read the code with the public key and write scores in a
--      juror's name into results that are supposed to be frozen.
--      The same results could also be written two other ways, with no deadline:
--        * over REST: policies sm_review_juror_write (FOR ALL, own row and
--          sm_is_event_juror) and sm_criterion_score_all (FOR ALL, own review)
--          let any of the 36 confirmed SM26 jurors insert, update or delete
--          their own sm_review / sm_criterion_score rows (SM26JuryPage does this
--          with an upsert). Neither table has a deadline trigger. Architecture
--          reviews live in the same tables (competition architecture_pro/_student);
--        * sm_jury_save_score_by_token and sm_architecture_save_score_by_token
--          (SECURITY DEFINER, EXECUTE for anon, per-juror / per-reviewer secret
--          token): no closing check in either body.
--      No SM26 review was written after 21 Sep (last: innovation 21 Sep 11:27
--      UTC, architecture 7 Sep), so closing at the end of the event loses nothing.
-- S9   /sm26/register has no end date. A logged-in member registers by inserting
--      sm_registration directly (policy sm_registration_insert only checks
--      user_id = auth.uid()); guests go through the sm26-register edge function.
--
-- ════════════════════════════════════════════════════════════════════════════
-- What this migration changes
-- ════════════════════════════════════════════════════════════════════════════
-- 1. sm_deadline_instant(text, text): parses a closing setting. A bare
--    'YYYY-MM-DD' means "open through that day" in the event's timezone (the same
--    reading as edit_locks_at / roster_locks_at); anything else is cast to
--    timestamptz. Internal (no EXECUTE for anon/authenticated).
-- 2. sm_event_window_closed(uuid, text): true once the settings key named has
--    passed; without that key, once the event's end_date is over (event time).
--    Fails CLOSED on an unreadable setting or a missing date. Internal. Two
--    public wrappers read it (harmless booleans, EXECUTE for anon/authenticated
--    because RLS policies call them as the caller):
--      * sm_open_score_closed(uuid)   -> settings.open_score_closes_at
--      * sm_jury_scoring_closed(uuid) -> settings.jury_closes_at
--    Two keys, so open scoring and the jury can be reopened separately.
-- 3. sm_registrations_open(uuid): true ONLY when settings.registrations_open is
--    JSON true and settings.registrations_close_at (optional) has not passed.
--    Default closed. Used by the RLS policy below, by sm26-register, sm26-draft
--    and by SM26RegisterPage (closed state). Harmless boolean, EXECUTE for anon.
-- 4. The open-score code moves out of the anon-readable settings into a new
--    table public.sm_event_secret (RLS on, no policy, no grant to anon or
--    authenticated). Why not a column privilege or a view: anon reads
--    sm_event.settings on purpose and a column REVOKE would break it:
--      * SM26Agenda.tsx:105/109 (public /sm26/agenda and /events/:id) reads
--        settings.programme_published as anon;
--      * useSm26EditLock.ts:11/31 (edit_locks_at, roster_locks_at),
--        SM26ArchitectureEntry.tsx:68 (architecture_closes_at) for members;
--      * AdminSM26Agenda/Architecture/Health/Invitations for staff.
--    A safe view would need every one of those callers changed. Nothing in src/
--    or supabase/functions reads open_score_code (grep), only the five
--    sm_open_score_* functions, which now look it up through
--    sm_open_score_event_for_code(text) (internal, SECURITY DEFINER).
-- 5. The five sm_open_score_* functions are re-created with their exact
--    signatures, SECURITY DEFINER and search_path, bodies unchanged except:
--      * the code lookup goes through sm_open_score_event_for_code();
--      * sm_open_score_submit (the only one that writes) answers
--        {ok:false, error:'scoring_closed'} once sm_open_score_closed() is true;
--      * sm_open_score_context also returns 'closed' (boolean) so the page can
--        show a read-only state later. Existing keys unchanged.
--    The read-only ones (context, entry, check_name, mine) keep working after
--    the close, so results stay viewable with the code. Their ACLs are kept by
--    CREATE OR REPLACE.
-- 6. Restrictive INSERT policy on sm_registration: staff, or registrations open.
--    Closes the member path (direct insert) with the same flag as the guest path.
--    Not affected: sm_admin_create_registration and sm_invitation_to_participant
--    (SECURITY DEFINER, owner postgres has BYPASSRLS), and the edge functions
--    that insert with the service role (sm26-register, sm26-import,
--    sm26-provision, sm26-attendee-invite, sm26-reminders).
-- 7. Jury results, REST path: RESTRICTIVE policies on sm_review and
--    sm_criterion_score, one per command (INSERT, UPDATE, DELETE), each
--    "staff, or jury scoring still open" (sm_jury_scoring_closed of the review's
--    event). Not FOR ALL and nothing on SELECT: jurors keep reading their own
--    reviews, and staff (sm_is_staff()) can still correct a score.
-- 8. Jury results, token path: sm_jury_save_score_by_token and
--    sm_architecture_save_score_by_token are re-created with their exact
--    signatures, defaults, SECURITY DEFINER and search_path ('public'), bodies
--    unchanged except one check: {ok:false, error:'scoring_closed'} once
--    sm_jury_scoring_closed(event) is true. The RLS policies of step 7 cannot
--    do this, because these functions run as postgres (BYPASSRLS). ACLs are
--    kept by CREATE OR REPLACE. The read functions (sm_jury_scorecard_by_token,
--    sm_architecture_review_by_token) are untouched, so the links still show
--    what was scored.
--    sm_open_score_submit (step 5) writes sm_review too, but keeps its own key
--    (open_score_closes_at). sm_admin_open_score_attribute is staff-only and is
--    left alone.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Rows written (config only, ONE row)
-- ════════════════════════════════════════════════════════════════════════════
-- The sm26 row of sm_event: settings loses 'open_score_code' (copied first into
-- sm_event_secret) and gains, only if absent, 'open_score_closes_at' and
-- 'jury_closes_at' = end_date ('2026-09-21', i.e. closed from 22 Sep 00:00
-- Monaco) and 'registrations_open' = false, so the state is visible to whoever
-- reads the settings. The code defaults to the same values without those keys.
-- No registration, attendee, review, score or vote row is touched. The
-- open-score code is NOT rotated: links already sent keep opening the
-- read-only views.
--
-- Callers checked
-- ───────────────
--   SM26OpenScorePage.tsx:59,81,82,103,157 (context, check_name, mine, entry,
--     submit). After the close, submit shows "Could not save your score —
--     scoring_closed" (toast from r.error). Reads unchanged.
--   AdminSM26OpenScores.tsx (sm_admin_open_scores / _attribute / _discard):
--     untouched, staff-only (sm_is_staff()).
--   SM26RegisterPage.tsx:536 (only client-side INSERT into sm_registration):
--     blocked when closed, and the page now shows a closed state instead.
--   All sm_event readers in src/ (grep "sm_event"): they select id / slug /
--     name / legacy_event_id / settings; none selects open_score_code, and the
--     table grants are unchanged, so none breaks.
--   SM26JuryPage.tsx:193 (read own review + scores): unchanged.
--   SM26JuryPage.tsx:341,371 (juror upsert into sm_review / sm_criterion_score):
--     refused after the close with an RLS error, shown in the existing
--     "Could not save" / "Scores could not be saved" toast.
--   SM26JuryScorePage.tsx:97 (sm_jury_save_score_by_token) and
--     SM26ArchitectureReviewPage.tsx:171 (sm_architecture_save_score_by_token):
--     'scoring_closed' falls into their generic "Could not save" toast. Their
--     read RPCs (:56, :95) are untouched.
--   No edge function in supabase/functions reads or writes sm_review or
--     sm_criterion_score (grep). Admin pages read reviews through SECURITY
--     DEFINER RPCs, or as staff, which the new policies exempt.
--
-- Idempotent: CREATE OR REPLACE / IF NOT EXISTS / DROP POLICY IF EXISTS; the
-- copy is an upsert and the settings UPDATE only fires while there is something
-- left to do.
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO
-- ════════════════════════════════════════════════════════════════════════════
-- Reopen without code changes (config only):
--   scoring:        update public.sm_event set settings = jsonb_set(settings,
--                     '{open_score_closes_at}', '"2026-12-31"') where slug = 'sm26';
--   registrations:  update public.sm_event set settings = settings
--                     || '{"registrations_open": true}' where slug = 'sm26';
--   jury (REST and token links):
--                   update public.sm_event set settings = jsonb_set(settings,
--                     '{jury_closes_at}', '"2026-12-31"') where slug = 'sm26';
-- Full revert:
--   drop policy if exists sm_registration_insert_while_open on public.sm_registration;
--   drop policy if exists sm_review_insert_while_jury_open on public.sm_review;
--   drop policy if exists sm_review_update_while_jury_open on public.sm_review;
--   drop policy if exists sm_review_delete_while_jury_open on public.sm_review;
--   drop policy if exists sm_criterion_score_insert_while_jury_open on public.sm_criterion_score;
--   drop policy if exists sm_criterion_score_update_while_jury_open on public.sm_criterion_score;
--   drop policy if exists sm_criterion_score_delete_while_jury_open on public.sm_criterion_score;
--   update public.sm_event e
--      set settings = e.settings - 'open_score_closes_at' - 'jury_closes_at'
--                     - 'registrations_open'
--                     || jsonb_build_object('open_score_code', s.open_score_code)
--     from public.sm_event_secret s
--    where s.event_id = e.id and s.open_score_code is not null;
--   then re-create the five sm_open_score_* functions from their previous
--   definitions (supabase_migrations.schema_migrations, or the bodies in this file
--   with "v_event := sm_open_score_event_for_code(p_code)" replaced by the
--   original "select id into v_event from sm_event where slug = 'sm26' and
--   coalesce(settings->>'open_score_code','') <> '' and
--   settings->>'open_score_code' = coalesce(p_code, '')" and the 'scoring_closed'
--   / 'closed' lines removed), and re-create sm_jury_save_score_by_token and
--   sm_architecture_save_score_by_token from the bodies in this file with their
--   "scoring_closed" block (3 lines + comment) removed. Only then:
--   drop function if exists public.sm_open_score_event_for_code(text);
--   drop function if exists public.sm_open_score_closed(uuid);
--   drop function if exists public.sm_jury_scoring_closed(uuid);
--   drop function if exists public.sm_event_window_closed(uuid, text);
--   drop function if exists public.sm_registrations_open(uuid);   -- after the edge functions are reverted
--   drop function if exists public.sm_deadline_instant(text, text);
--   drop table if exists public.sm_event_secret;

-- ─── 1. Deadline parser ─────────────────────────────────────────────────────
create or replace function public.sm_deadline_instant(p_raw text, p_tz text)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $function$
declare
  v_raw text := nullif(btrim(coalesce(p_raw, '')), '');
  v_tz  text := coalesce(nullif(btrim(coalesce(p_tz, '')), ''), 'Europe/Monaco');
begin
  if v_raw is null then return null; end if;
  if v_raw ~ '^\d{4}-\d{2}-\d{2}$' then
    -- "Open through that day": the instant the next day starts, event time.
    return (v_raw::date + 1)::timestamp at time zone v_tz;
  end if;
  return v_raw::timestamptz;
end
$function$;

revoke all on function public.sm_deadline_instant(text, text) from public, anon, authenticated;
grant execute on function public.sm_deadline_instant(text, text) to service_role;

-- ─── 2. Scoring windows closed? (open scoring, jury) ────────────────────────
-- p_key names the settings key; without it, the end of the event's last day.
create or replace function public.sm_event_window_closed(p_event_id uuid, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_raw   text;
  v_end   date;
  v_tz    text;
  v_close timestamptz;
begin
  select e.settings->>p_key, e.end_date, e.timezone
    into v_raw, v_end, v_tz
    from sm_event e
   where e.id = p_event_id;
  if not found then return true; end if;

  v_close := coalesce(sm_deadline_instant(v_raw, v_tz),
                      sm_deadline_instant(to_char(v_end, 'YYYY-MM-DD'), v_tz));
  -- No closing time at all: closed. Scoring has to be opened on purpose.
  if v_close is null then return true; end if;
  return now() >= v_close;
exception when others then
  return true;  -- unreadable setting: fail closed
end
$function$;

revoke all on function public.sm_event_window_closed(uuid, text) from public, anon, authenticated;
grant execute on function public.sm_event_window_closed(uuid, text) to service_role;

-- Open scoring (/sm26/score, sm_open_score_submit).
create or replace function public.sm_open_score_closed(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select public.sm_event_window_closed(p_event_id, 'open_score_closes_at');
$function$;

revoke all on function public.sm_open_score_closed(uuid) from public;
grant execute on function public.sm_open_score_closed(uuid) to anon, authenticated, service_role;

-- Jury scoring (SM26JuryPage over REST, the two *_save_score_by_token links).
-- Called by RLS policies as the caller, hence EXECUTE for anon/authenticated.
create or replace function public.sm_jury_scoring_closed(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select public.sm_event_window_closed(p_event_id, 'jury_closes_at');
$function$;

revoke all on function public.sm_jury_scoring_closed(uuid) from public;
grant execute on function public.sm_jury_scoring_closed(uuid) to anon, authenticated, service_role;

-- ─── 3. Registrations open? (default closed) ────────────────────────────────
create or replace function public.sm_registrations_open(p_event_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_s     jsonb;
  v_tz    text;
  v_close timestamptz;
begin
  select coalesce(e.settings, '{}'::jsonb), e.timezone
    into v_s, v_tz
    from sm_event e
   where e.id = p_event_id;
  if not found then return false; end if;

  -- Closed unless staff opened it explicitly with a JSON true.
  if (v_s->'registrations_open') is distinct from 'true'::jsonb then return false; end if;

  v_close := sm_deadline_instant(v_s->>'registrations_close_at', v_tz);
  return v_close is null or now() < v_close;
exception when others then
  return false;  -- unreadable setting: fail closed
end
$function$;

revoke all on function public.sm_registrations_open(uuid) from public;
grant execute on function public.sm_registrations_open(uuid) to anon, authenticated, service_role;

-- ─── 4. The open-score code leaves the anon-readable settings ───────────────
create table if not exists public.sm_event_secret (
  event_id        uuid primary key references public.sm_event(id) on delete cascade,
  open_score_code text,
  updated_at      timestamptz not null default now()
);
comment on table public.sm_event_secret is
  'Per-event secrets that must never be readable through the API (sm_event.settings is public). '
  'Read only by SECURITY DEFINER functions; no policy, no grant to anon/authenticated.';

alter table public.sm_event_secret enable row level security;
revoke all on table public.sm_event_secret from public, anon, authenticated;
grant select, insert, update, delete on table public.sm_event_secret to service_role;

-- Copy first (exact value, the comparison has always been exact)...
insert into public.sm_event_secret (event_id, open_score_code)
select e.id, e.settings->>'open_score_code'
  from public.sm_event e
 where e.slug = 'sm26'
   and coalesce(e.settings->>'open_score_code', '') <> ''
on conflict (event_id) do update
  set open_score_code = excluded.open_score_code,
      updated_at      = now();

-- ...then strip it, and make the closing state visible (existing keys win).
update public.sm_event e
   set settings = jsonb_strip_nulls(jsonb_build_object(
                    'open_score_closes_at', to_char(e.end_date, 'YYYY-MM-DD'),
                    'jury_closes_at',       to_char(e.end_date, 'YYYY-MM-DD'),
                    'registrations_open',   false))
                  || (coalesce(e.settings, '{}'::jsonb) - 'open_score_code'),
       updated_at = now()
 where e.slug = 'sm26'
   and (coalesce(e.settings, '{}'::jsonb) ? 'open_score_code'
        or not (coalesce(e.settings, '{}'::jsonb) ? 'open_score_closes_at')
        or not (coalesce(e.settings, '{}'::jsonb) ? 'jury_closes_at')
        or not (coalesce(e.settings, '{}'::jsonb) ? 'registrations_open'));

-- Code -> event id (null when the code is wrong). Internal.
create or replace function public.sm_open_score_event_for_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select e.id
    from sm_event e
    join sm_event_secret s on s.event_id = e.id
   where e.slug = 'sm26'
     and coalesce(s.open_score_code, '') <> ''
     and s.open_score_code = coalesce(p_code, '')
   limit 1;
$function$;

revoke all on function public.sm_open_score_event_for_code(text) from public, anon, authenticated;
grant execute on function public.sm_open_score_event_for_code(text) to service_role;

-- ─── 5. The five open-score functions ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sm_open_score_check_name(p_code text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event uuid;
  v_matches int;
  v_display text;
begin
  v_event := sm_open_score_event_for_code(p_code);
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;

  if length(trim(coalesce(p_name, ''))) < 3 then
    return jsonb_build_object('ok', true, 'recognised', false, 'reason', 'too_short');
  end if;

  select count(*), min(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')))
    into v_matches, v_display
  from sm_role_assignment ra
  join sm_registration r on r.id = ra.registration_id
  join profiles p on p.user_id = r.user_id
  where ra.event_id = v_event and ra.role = 'jury' and ra.status = 'confirmed'
    and r.user_id is not null
    and sm_norm_name(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) = sm_norm_name(p_name);

  return jsonb_build_object('ok', true, 'recognised', v_matches = 1,
                            'display_name', case when v_matches = 1 then v_display else null end);
end
$function$;

CREATE OR REPLACE FUNCTION public.sm_open_score_context(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event uuid;
begin
  v_event := sm_open_score_event_for_code(p_code);
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;

  return jsonb_build_object(
    'ok', true,
    -- Scoring has closed: the page may still list and show entries, submit refuses.
    'closed', sm_open_score_closed(v_event),
    'entries', coalesce((
      select jsonb_agg(e order by e->>'company')
      from (
        select jsonb_build_object(
                 'entry_id', ra.id,
                 'company', coalesce(nullif(trim(r.company_name),''),
                                     nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')),''), 'Entry'),
                 'stage', coalesce(sp.stage, ''),
                 'template_key', case
                   when sp.stage in ('Idea','Prototype','Pilot','Pre-revenue','Pre-seed stage','Seed stage','Early stage') then 'pre_revenue'
                   when sp.stage in ('Early revenue','Scaling revenue','Scale-up / Established','Growth stage','Expansion stage') then 'post_revenue'
                   else 'general' end
               ) as e
        from sm_role_assignment ra
        join sm_registration r on r.id = ra.registration_id
        left join sm_startup_profile sp on sp.role_assignment_id = ra.id
        where ra.event_id = v_event and ra.role = 'startup'
          and ra.status <> 'declined' and r.status not in ('declined','cancelled')
      ) z), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(t order by t->>'key')
      from (
        select jsonb_build_object(
                 'key', tp.key, 'name', tp.name, 'scale_max', tp.scale_max,
                 'criteria', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'id', c.id, 'label', c.label, 'description', c.description,
                            'weight', c.weight, 'critical', c.critical) order by c.display_order), '[]'::jsonb)
                   from sm_criterion c where c.template_id = tp.id)
               ) as t
        from sm_scorecard_template tp
        where tp.event_id = v_event and tp.competition = 'innovation' and tp.is_active
      ) z), '[]'::jsonb));
end
$function$;

CREATE OR REPLACE FUNCTION public.sm_open_score_entry(p_code text, p_entry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event uuid;
  v_out jsonb;
begin
  v_event := sm_open_score_event_for_code(p_code);
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;

  select jsonb_build_object(
    'ok', true,
    'company', coalesce(nullif(trim(r.company_name),''),
                        nullif(trim(coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')),''), 'Entry'),
    'country', r.country,
    'website', r.website,
    'stage', sp.stage,
    'startup_or_scaleup', sp.startup_or_scaleup,
    'categories', sp.categories,
    'fields', jsonb_strip_nulls(jsonb_build_object(
      'Activity', sp.organization_activity,
      'Problem', sp.problem,
      'Solution', sp.solution,
      'Differentiation', sp.differentiation,
      'USP', sp.usp,
      'Target markets', sp.target_markets,
      'Business model', sp.business_model,
      'Competitive positioning', sp.competitive_positioning,
      'Collaboration expected', sp.collaboration_expected,
      'References', sp.references_text))
  ) into v_out
  from sm_role_assignment ra
  join sm_registration r on r.id = ra.registration_id
  left join sm_startup_profile sp on sp.role_assignment_id = ra.id
  where ra.id = p_entry_id and ra.event_id = v_event and ra.role = 'startup'
    and ra.status <> 'declined' and r.status not in ('declined','cancelled');

  if v_out is null then return jsonb_build_object('ok', false, 'error', 'entry_not_found'); end if;
  return v_out;
end
$function$;

CREATE OR REPLACE FUNCTION public.sm_open_score_mine(p_code text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid; v_juror uuid; v_matches int;
begin
  v_event := sm_open_score_event_for_code(p_code);
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;
  if length(trim(coalesce(p_name,''))) < 3 then
    return jsonb_build_object('ok', true, 'scored', '[]'::jsonb);
  end if;

  select count(*), min(r.user_id::text)::uuid into v_matches, v_juror
  from sm_role_assignment ra
  join sm_registration r on r.id = ra.registration_id
  join profiles p on p.user_id = r.user_id
  where ra.event_id = v_event and ra.role = 'jury' and ra.status = 'confirmed'
    and r.user_id is not null
    and sm_norm_name(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) = sm_norm_name(p_name);

  return jsonb_build_object('ok', true, 'scored', coalesce((
    select jsonb_agg(distinct eid) from (
      select rv.entry_role_assignment_id as eid from sm_review rv
       where v_matches = 1 and rv.juror_user_id = v_juror
         and rv.event_id = v_event and rv.status = 'submitted'
      union
      select os.entry_role_assignment_id from sm_open_score os
       where os.event_id = v_event and sm_norm_name(os.juror_name) = sm_norm_name(p_name)
    ) z), '[]'::jsonb));
end
$function$;

CREATE OR REPLACE FUNCTION public.sm_open_score_submit(p_code text, p_juror_name text, p_entry_id uuid, p_scores jsonb, p_confidence integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event uuid; v_tpl record; v_key text;
  v_full numeric := 0; v_weighted numeric := 0; v_total numeric;
  v_missing int; v_review uuid; v_juror uuid; v_matches int; v_name text;
  c record; v_score numeric;
begin
  v_event := sm_open_score_event_for_code(p_code);
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;

  -- Results are frozen once scoring closes (settings.open_score_closes_at, else
  -- the end of the event's last day). Nothing below may write after that.
  if sm_open_score_closed(v_event) then
    return jsonb_build_object('ok', false, 'error', 'scoring_closed');
  end if;

  v_name := trim(coalesce(p_juror_name, ''));
  if length(v_name) < 3 then return jsonb_build_object('ok', false, 'error', 'name_required'); end if;
  if p_confidence is null or p_confidence not between 1 and 3 then
    return jsonb_build_object('ok', false, 'error', 'confidence_required');
  end if;

  select case
           when sp.stage in ('Idea','Prototype','Pilot','Pre-revenue','Pre-seed stage','Seed stage','Early stage') then 'pre_revenue'
           when sp.stage in ('Early revenue','Scaling revenue','Scale-up / Established','Growth stage','Expansion stage') then 'post_revenue'
           else 'general' end
    into v_key
  from sm_role_assignment ra
  left join sm_startup_profile sp on sp.role_assignment_id = ra.id
  where ra.id = p_entry_id and ra.event_id = v_event and ra.role = 'startup';
  if v_key is null then return jsonb_build_object('ok', false, 'error', 'entry_not_found'); end if;

  select t.id, t.scale_max into v_tpl
    from sm_scorecard_template t
   where t.event_id = v_event and t.competition = 'innovation' and t.key = v_key and t.is_active
   order by t.version desc limit 1;
  if v_tpl.id is null then return jsonb_build_object('ok', false, 'error', 'no_template'); end if;

  select count(*) into v_missing from sm_criterion
   where template_id = v_tpl.id and nullif(p_scores -> id::text ->> 'score', '') is null;
  if v_missing > 0 then
    return jsonb_build_object('ok', false, 'error', 'incomplete', 'missing', v_missing);
  end if;

  select coalesce(sum(weight),0) into v_full from sm_criterion where template_id = v_tpl.id;
  for c in select id, weight from sm_criterion where template_id = v_tpl.id loop
    v_score := nullif(p_scores -> c.id::text ->> 'score', '')::numeric;
    v_weighted := v_weighted + (v_score / v_tpl.scale_max) * c.weight;
  end loop;
  v_total := round((v_weighted / v_full) * 1000) / 10;

  select count(*), min(r.user_id::text)::uuid into v_matches, v_juror
  from sm_role_assignment ra
  join sm_registration r on r.id = ra.registration_id
  join profiles p on p.user_id = r.user_id
  where ra.event_id = v_event and ra.role = 'jury' and ra.status = 'confirmed'
    and r.user_id is not null
    and sm_norm_name(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) = sm_norm_name(v_name);

  if v_matches <> 1 then
    insert into sm_open_score (event_id, juror_name, entry_role_assignment_id, template_id,
                               scores, confidence, total_score)
    values (v_event, v_name, p_entry_id, v_tpl.id, p_scores, p_confidence, v_total);
    return jsonb_build_object('ok', true, 'matched', false, 'total_score', v_total,
                              'reason', case when v_matches = 0 then 'unknown_name' else 'ambiguous_name' end);
  end if;

  insert into sm_jury_assignment (event_id, juror_user_id, entry_role_assignment_id, competition, mandatory)
  values (v_event, v_juror, p_entry_id, 'innovation', true)
  on conflict (juror_user_id, entry_role_assignment_id) do nothing;

  insert into sm_review (
    juror_user_id, entry_role_assignment_id, event_id, competition, template_id,
    confidence, coi_flag, status, total_score, submitted_at, updated_at)
  values (
    v_juror, p_entry_id, v_event, 'innovation', v_tpl.id,
    p_confidence, false, 'submitted', v_total, now(), now())
  on conflict (juror_user_id, entry_role_assignment_id) do update
    set template_id  = excluded.template_id,
        confidence   = excluded.confidence,
        status       = 'submitted',
        total_score  = excluded.total_score,
        submitted_at = coalesce(sm_review.submitted_at, excluded.submitted_at),
        updated_at   = now()
  returning id into v_review;

  for c in select id from sm_criterion where template_id = v_tpl.id loop
    insert into sm_criterion_score (review_id, criterion_id, score, comment)
    values (v_review, c.id,
            nullif(p_scores -> c.id::text ->> 'score','')::numeric,
            nullif(trim(coalesce(p_scores -> c.id::text ->> 'comment','')), ''))
    on conflict (review_id, criterion_id) do update
      set score = excluded.score, comment = excluded.comment;
  end loop;

  return jsonb_build_object('ok', true, 'matched', true, 'total_score', v_total);
end
$function$;

-- ─── 6. Member path: no new registration while registrations are closed ─────
-- RESTRICTIVE, so it is ANDed with sm_registration_insert (user_id = auth.uid()).
drop policy if exists sm_registration_insert_while_open on public.sm_registration;
create policy sm_registration_insert_while_open on public.sm_registration
  as restrictive
  for insert
  to public
  with check (public.sm_is_staff() or public.sm_registrations_open(event_id));

-- ─── 7. Jury results, REST path: no juror write once jury scoring closed ────
-- RESTRICTIVE, ANDed with sm_review_juror_write / sm_criterion_score_all. One
-- policy per write command: a FOR ALL restrictive policy would also hide the
-- jurors' own reviews from them. TO public so anon is covered too should a
-- permissive anon policy ever appear.
drop policy if exists sm_review_insert_while_jury_open on public.sm_review;
create policy sm_review_insert_while_jury_open on public.sm_review
  as restrictive
  for insert
  to public
  with check (public.sm_is_staff() or not public.sm_jury_scoring_closed(event_id));

drop policy if exists sm_review_update_while_jury_open on public.sm_review;
create policy sm_review_update_while_jury_open on public.sm_review
  as restrictive
  for update
  to public
  using      (public.sm_is_staff() or not public.sm_jury_scoring_closed(event_id))
  with check (public.sm_is_staff() or not public.sm_jury_scoring_closed(event_id));

drop policy if exists sm_review_delete_while_jury_open on public.sm_review;
create policy sm_review_delete_while_jury_open on public.sm_review
  as restrictive
  for delete
  to public
  using (public.sm_is_staff() or not public.sm_jury_scoring_closed(event_id));

drop policy if exists sm_criterion_score_insert_while_jury_open on public.sm_criterion_score;
create policy sm_criterion_score_insert_while_jury_open on public.sm_criterion_score
  as restrictive
  for insert
  to public
  with check (public.sm_is_staff() or exists (
    select 1 from public.sm_review rv
     where rv.id = sm_criterion_score.review_id
       and not public.sm_jury_scoring_closed(rv.event_id)));

drop policy if exists sm_criterion_score_update_while_jury_open on public.sm_criterion_score;
create policy sm_criterion_score_update_while_jury_open on public.sm_criterion_score
  as restrictive
  for update
  to public
  using (public.sm_is_staff() or exists (
    select 1 from public.sm_review rv
     where rv.id = sm_criterion_score.review_id
       and not public.sm_jury_scoring_closed(rv.event_id)))
  with check (public.sm_is_staff() or exists (
    select 1 from public.sm_review rv
     where rv.id = sm_criterion_score.review_id
       and not public.sm_jury_scoring_closed(rv.event_id)));

drop policy if exists sm_criterion_score_delete_while_jury_open on public.sm_criterion_score;
create policy sm_criterion_score_delete_while_jury_open on public.sm_criterion_score
  as restrictive
  for delete
  to public
  using (public.sm_is_staff() or exists (
    select 1 from public.sm_review rv
     where rv.id = sm_criterion_score.review_id
       and not public.sm_jury_scoring_closed(rv.event_id)));

-- ─── 8. Jury results, token path ────────────────────────────────────────────
-- Exact production definitions (pg_get_functiondef, 7 Oct 2026); the only
-- change in each is the 'scoring_closed' block. These run as postgres
-- (BYPASSRLS), so the policies of step 7 do not reach them.
CREATE OR REPLACE FUNCTION public.sm_jury_save_score_by_token(p_token text, p_entry_role_assignment_id uuid, p_scores jsonb, p_confidence integer DEFAULT NULL::integer, p_coi boolean DEFAULT false, p_submit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sj sm_jury_session_juror%rowtype;
  v_event uuid;
  v_tpl record;
  v_review uuid;
  v_full numeric := 0;
  v_scored numeric := 0;
  v_weighted numeric := 0;
  v_total numeric;
  v_missing int;
  c record;
  v_score numeric;
begin
  if coalesce(p_token, '') = '' then return jsonb_build_object('ok', false, 'error', 'missing_token'); end if;

  select * into v_sj from sm_jury_session_juror where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;

  if not exists (select 1 from sm_jury_session_entry se
                  where se.session_id = v_sj.session_id
                    and se.entry_role_assignment_id = p_entry_role_assignment_id) then
    return jsonb_build_object('ok', false, 'error', 'not_in_this_session');
  end if;

  select s.event_id into v_event from sm_jury_session s where s.id = v_sj.session_id;

  -- Results are frozen once jury scoring closes (settings.jury_closes_at, else
  -- the end of the event's last day). Nothing below may write after that.
  if sm_jury_scoring_closed(v_event) then
    return jsonb_build_object('ok', false, 'error', 'scoring_closed');
  end if;

  -- Same rule as sm_is_event_juror, which gates the logged-in scorecard.
  if not exists (
    select 1 from sm_role_assignment ra
    join sm_registration r on r.id = ra.registration_id
    where ra.event_id = v_event and ra.role = 'jury' and ra.status = 'confirmed'
      and r.user_id = v_sj.juror_user_id)
  then
    return jsonb_build_object('ok', false, 'error', 'role_not_confirmed');
  end if;

  select t.id, t.scale_max into v_tpl
    from sm_scorecard_template t
   where t.event_id = v_event and t.competition = 'innovation' and t.is_active
   order by t.version desc limit 1;
  if v_tpl.id is null then return jsonb_build_object('ok', false, 'error', 'no_template'); end if;

  select coalesce(sum(weight), 0) into v_full from sm_criterion where template_id = v_tpl.id;
  for c in select id, weight from sm_criterion where template_id = v_tpl.id loop
    v_score := nullif(p_scores -> c.id::text ->> 'score', '')::numeric;
    if v_score is not null then
      v_weighted := v_weighted + (v_score / v_tpl.scale_max) * c.weight;
      v_scored := v_scored + c.weight;
    end if;
  end loop;
  v_total := case when v_scored > 0 and v_full > 0
                  then round((v_weighted / v_full) * 1000) / 10 else null end;

  if p_submit then
    select count(*) into v_missing from sm_criterion
     where template_id = v_tpl.id
       and nullif(p_scores -> id::text ->> 'score', '') is null;
    if v_missing > 0 then
      return jsonb_build_object('ok', false, 'error', 'incomplete', 'missing', v_missing);
    end if;
  end if;

  insert into sm_review (
    juror_user_id, entry_role_assignment_id, event_id, competition, template_id,
    confidence, coi_flag, status, total_score, submitted_at, updated_at)
  values (
    v_sj.juror_user_id, p_entry_role_assignment_id, v_event, 'innovation', v_tpl.id,
    p_confidence, coalesce(p_coi, false),
    case when p_submit then 'submitted' else 'draft' end,
    v_total,
    case when p_submit then now() else null end, now())
  on conflict (juror_user_id, entry_role_assignment_id) do update
    set template_id = excluded.template_id,
        confidence = excluded.confidence,
        coi_flag = excluded.coi_flag,
        status = case when excluded.status = 'submitted' or sm_review.status = 'submitted' then 'submitted' else excluded.status end,
        total_score = excluded.total_score,
        submitted_at = coalesce(sm_review.submitted_at, excluded.submitted_at),
        updated_at = now()
  returning id into v_review;

  for c in select id from sm_criterion where template_id = v_tpl.id loop
    insert into sm_criterion_score (review_id, criterion_id, score, comment)
    values (v_review, c.id,
            nullif(p_scores -> c.id::text ->> 'score', '')::numeric,
            nullif(trim(coalesce(p_scores -> c.id::text ->> 'comment', '')), ''))
    on conflict (review_id, criterion_id) do update
      set score = excluded.score, comment = excluded.comment;
  end loop;

  return jsonb_build_object('ok', true, 'status', case when p_submit then 'submitted' else 'draft' end,
                            'total_score', v_total);
end $function$;

CREATE OR REPLACE FUNCTION public.sm_architecture_save_score_by_token(p_token text, p_entry_role_assignment_id uuid, p_scores jsonb, p_confidence integer DEFAULT NULL::integer, p_coi boolean DEFAULT false, p_submit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_r           sm_architecture_reviewer%rowtype;
  v_role        text;
  v_competition text;
  v_tpl         record;
  v_review      uuid;
  v_full        numeric := 0;
  v_scored      numeric := 0;
  v_weighted    numeric := 0;
  v_total       numeric;
  v_missing     int;
  c             record;
  v_score       numeric;
begin
  if coalesce(p_token, '') = '' then return jsonb_build_object('ok', false, 'error', 'missing_token'); end if;

  select * into v_r from sm_architecture_reviewer where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  if v_r.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;

  -- Results are frozen once jury scoring closes (settings.jury_closes_at, else
  -- the end of the event's last day). Nothing below may write after that.
  if sm_jury_scoring_closed(v_r.event_id) then
    return jsonb_build_object('ok', false, 'error', 'scoring_closed');
  end if;

  -- The token names an event, not an entry: check the entry is a live
  -- architecture entry of THAT event, or one link would score another's jury.
  select ra.role into v_role
    from sm_role_assignment ra
    join sm_registration r on r.id = ra.registration_id
    join sm_architecture_entry ae on ae.role_assignment_id = ra.id
   where ra.id = p_entry_role_assignment_id
     and ra.event_id = v_r.event_id
     and ra.role like 'architect%'
     and ra.status <> 'declined'
     and r.status not in ('declined', 'cancelled')
     and ae.anon_code is not null;
  if v_role is null then return jsonb_build_object('ok', false, 'error', 'not_an_entry'); end if;

  -- sm_review.competition is granular — sm_admin_rankings is called once per
  -- value, so a pro entry filed under 'architecture' would rank nowhere.
  v_competition := case when v_role = 'architect_student' then 'architecture_student'
                        else 'architecture_pro' end;

  select t.id, t.scale_max into v_tpl
    from sm_scorecard_template t
   where t.event_id = v_r.event_id and t.competition = 'architecture' and t.is_active
   order by t.version desc limit 1;
  if v_tpl.id is null then return jsonb_build_object('ok', false, 'error', 'no_template'); end if;

  select coalesce(sum(weight), 0) into v_full from sm_criterion where template_id = v_tpl.id;
  for c in select id, weight from sm_criterion where template_id = v_tpl.id loop
    v_score := nullif(p_scores -> c.id::text ->> 'score', '')::numeric;
    if v_score is not null then
      v_weighted := v_weighted + (v_score / v_tpl.scale_max) * c.weight;
      v_scored := v_scored + c.weight;
    end if;
  end loop;
  v_total := case when v_scored > 0 and v_full > 0
                  then round((v_weighted / v_full) * 1000) / 10 else null end;

  if p_submit then
    select count(*) into v_missing from sm_criterion
     where template_id = v_tpl.id
       and nullif(p_scores -> id::text ->> 'score', '') is null;
    if v_missing > 0 then
      return jsonb_build_object('ok', false, 'error', 'incomplete', 'missing', v_missing);
    end if;
  end if;

  insert into sm_review (
    juror_user_id, entry_role_assignment_id, event_id, competition, template_id,
    confidence, coi_flag, status, total_score, submitted_at, updated_at)
  values (
    v_r.juror_user_id, p_entry_role_assignment_id, v_r.event_id, v_competition, v_tpl.id,
    p_confidence, coalesce(p_coi, false),
    case when p_submit then 'submitted' else 'draft' end,
    v_total,
    case when p_submit then now() else null end, now())
  on conflict (juror_user_id, entry_role_assignment_id) do update
    set template_id  = excluded.template_id,
        competition  = excluded.competition,
        confidence   = excluded.confidence,
        coi_flag     = excluded.coi_flag,
        status = case when excluded.status = 'submitted' or sm_review.status = 'submitted' then 'submitted' else excluded.status end,
        total_score  = excluded.total_score,
        submitted_at = coalesce(sm_review.submitted_at, excluded.submitted_at),
        updated_at   = now()
  returning id into v_review;

  -- Belt and braces on the invariant that decides whether any of this counts.
  insert into sm_jury_assignment
         (event_id, juror_user_id, entry_role_assignment_id, competition, mandatory)
  values (v_r.event_id, v_r.juror_user_id, p_entry_role_assignment_id, v_competition, true)
  on conflict (juror_user_id, entry_role_assignment_id) do nothing;

  for c in select id from sm_criterion where template_id = v_tpl.id loop
    insert into sm_criterion_score (review_id, criterion_id, score, comment)
    values (v_review, c.id,
            nullif(p_scores -> c.id::text ->> 'score', '')::numeric,
            nullif(trim(coalesce(p_scores -> c.id::text ->> 'comment', '')), ''))
    on conflict (review_id, criterion_id) do update
      set score = excluded.score, comment = excluded.comment;
  end loop;

  return jsonb_build_object('ok', true,
                            'status', case when p_submit then 'submitted' else 'draft' end,
                            'total_score', v_total);
end $function$;

notify pgrst, 'reload schema';
