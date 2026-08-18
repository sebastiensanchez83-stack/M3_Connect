-- SM26 — the external architecture jury scores without an account.
--
-- The architecture jury is not the innovation jury. Its members are invited
-- architects and academics who will, in the user's words, "most probably not
-- join the platform": asking them to create an account, verify an email and
-- wait for a persona to be granted is how a scoresheet never comes back. So
-- each of them gets one unguessable link instead, and that link is their whole
-- identity — sm_architecture_reviewer is a juror who does not exist in
-- auth.users.
--
-- That works because sm_review.juror_user_id, though not null, carries no
-- foreign key: a synthetic uuid minted here is as good as a real one. What it
-- does NOT survive on its own is the Awards Score. sm_admin_rankings only counts
-- a review when a mandatory sm_jury_assignment row exists for the SAME
-- juror_user_id on the SAME entry:
--
--     join sm_jury_assignment ja on ja.entry_role_assignment_id = rv.entry_role_assignment_id
--      and ja.juror_user_id = rv.juror_user_id and ja.mandatory
--
-- Miss those rows and the external scores sit in sm_review looking perfectly
-- healthy while the ranking silently ignores every one of them. Creating a
-- reviewer therefore creates their assignments too, and saving a score
-- re-asserts the one it needs — see the comments at both sites.
--
-- Entries stay anonymous. A reviewer is handed an anon_code and a category and
-- nothing else: no company, no name, no filename. Nothing in this file selects
-- an identifying column, which is the point of the joins looking heavier than
-- they need to.
--
-- Applied through the MCP `apply_migration`, which already wraps this file in a
-- transaction — an explicit begin/commit here would fight it.

-- ─── 1. the reviewer ────────────────────────────────────────────────────────
create table if not exists public.sm_architecture_reviewer (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.sm_event(id) on delete cascade,
  name          text not null,
  email         text,
  token         text not null unique,
  juror_user_id uuid not null unique default gen_random_uuid(),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);

comment on table public.sm_architecture_reviewer is
  'An architecture juror who scores by magic link and has no platform account. One row = one link.';
comment on column public.sm_architecture_reviewer.token is
  'The secret in the URL. Unguessable and the only credential — treat it as a password, never log it.';
comment on column public.sm_architecture_reviewer.juror_user_id is
  'Synthetic juror identity used in sm_review and sm_jury_assignment. Points at no auth.users row, on purpose.';
comment on column public.sm_architecture_reviewer.created_by is
  'Staff member who minted the link. Deliberately no FK: the audit note must outlive the account.';
comment on column public.sm_architecture_reviewer.revoked_at is
  'Set = the link is dead. Scores already recorded are untouched and keep counting.';

create index if not exists sm_architecture_reviewer_event_idx
  on public.sm_architecture_reviewer (event_id);

alter table public.sm_architecture_reviewer enable row level security;

-- Staff only, and no policy for anon or authenticated. The token functions below
-- are SECURITY DEFINER precisely so a reviewer never needs a row-level grant:
-- the link is checked inside the function, not by RLS.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'sm_architecture_reviewer'
                    and policyname = 'sm_architecture_reviewer_staff') then
    create policy sm_architecture_reviewer_staff on public.sm_architecture_reviewer
      for all to authenticated using (sm_is_staff()) with check (sm_is_staff());
  end if;
end $$;

grant select, insert, update, delete on public.sm_architecture_reviewer to authenticated, service_role;

-- ─── 2. minting a link ──────────────────────────────────────────────────────

/**
 * Create an external reviewer and everything the ranking needs to count them.
 *
 * The sm_jury_assignment insert is not bookkeeping — it is the difference
 * between scores that count and scores that vanish. See the header.
 */
create or replace function public.sm_architecture_reviewer_add(
  p_event_id uuid,
  p_name     text,
  p_email    text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name  text := nullif(trim(coalesce(p_name, '')), '');
  v_token text;
  v_id    uuid;
  v_juror uuid;
begin
  if not sm_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_event_id is null then return jsonb_build_object('ok', false, 'error', 'missing_event'); end if;
  if v_name is null    then return jsonb_build_object('ok', false, 'error', 'missing_name');  end if;

  -- 24 random bytes → 32 base64 chars, then the three characters that do not
  -- survive a query string are swapped out ('=' and any wrap newline dropped).
  -- pgcrypto lives in `extensions`, and search_path here is 'public' only.
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), E'+/=\n', '-_');

  insert into public.sm_architecture_reviewer (event_id, name, email, token, created_by)
  values (p_event_id, v_name, nullif(trim(coalesce(p_email, '')), ''), v_token, auth.uid())
  returning id, juror_user_id into v_id, v_juror;

  -- Every live architecture entry, mandatory, under the synthetic juror id.
  -- Without these rows sm_admin_rankings drops this reviewer's scores on the
  -- floor without complaining. `mandatory` is what the ranking join tests.
  insert into public.sm_jury_assignment
         (event_id, juror_user_id, entry_role_assignment_id, competition, mandatory, assigned_by)
  select ra.event_id, v_juror, ra.id,
         case when ra.role = 'architect_student' then 'architecture_student'
              else 'architecture_pro' end,
         true, auth.uid()
    from public.sm_role_assignment ra
    join public.sm_registration r on r.id = ra.registration_id
    join public.sm_architecture_entry ae on ae.role_assignment_id = ra.id
   where ra.event_id = p_event_id
     and ra.role like 'architect%'
     and ra.status <> 'declined'
     and r.status not in ('declined', 'cancelled')
     -- No anon_code, no anonymous way to show it — so it is not scoreable and
     -- must not be assigned, or the reviewer's progress reads n/13 forever.
     and ae.anon_code is not null
  on conflict (juror_user_id, entry_role_assignment_id) do nothing;

  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token, 'name', v_name);
end $function$;

-- ─── 3. the admin list ──────────────────────────────────────────────────────

/**
 * One row per external reviewer with their progress, for the admin panel.
 * `token` is returned because staff need to copy the link — this is the only
 * place it ever leaves the database.
 */
create or replace function public.sm_architecture_reviewer_list(p_event_id uuid)
returns table (
  id         uuid,
  name       text,
  email      text,
  token      text,
  created_at timestamptz,
  revoked_at timestamptz,
  submitted  int,
  drafted    int,
  total      int)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_total int;
begin
  if not sm_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;

  -- Same live set as sm_architecture_reviewer_add, so n/total is honest.
  select count(*)::int into v_total
    from public.sm_role_assignment ra
    join public.sm_registration r on r.id = ra.registration_id
    join public.sm_architecture_entry ae on ae.role_assignment_id = ra.id
   where ra.event_id = p_event_id
     and ra.role like 'architect%'
     and ra.status <> 'declined'
     and r.status not in ('declined', 'cancelled')
     and ae.anon_code is not null;

  return query
  select rv.id, rv.name, rv.email, rv.token, rv.created_at, rv.revoked_at,
         (select count(*)::int from public.sm_review s
           where s.juror_user_id = rv.juror_user_id
             and s.event_id = rv.event_id and s.status = 'submitted'),
         (select count(*)::int from public.sm_review s
           where s.juror_user_id = rv.juror_user_id
             and s.event_id = rv.event_id and s.status = 'draft'),
         v_total
    from public.sm_architecture_reviewer rv
   where rv.event_id = p_event_id
   order by rv.created_at;
end $function$;

-- ─── 4. killing a link ──────────────────────────────────────────────────────

/**
 * Revoke or restore a reviewer's link.
 *
 * Revoking blocks the LINK and nothing else. The reviews already in sm_review
 * keep their scores, and their sm_jury_assignment rows are left alone, so those
 * scores go on counting towards the Awards Score exactly as before — which is
 * what you want when a juror finishes and you close their access, and what you
 * must delete rows for if you actually meant to discard their judgement.
 */
create or replace function public.sm_architecture_reviewer_revoke(
  p_id uuid, p_revoked boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not sm_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;

  update public.sm_architecture_reviewer
     set revoked_at = case when p_revoked then now() else null end
   where id = p_id;
end $function$;

-- ─── 5. the scorecard behind the link ───────────────────────────────────────

/**
 * Everything the no-login page renders, in one call. No auth.
 *
 * Anonymity is a hard requirement: an entry is an anon_code and a category. The
 * joins reach sm_registration only to test its status — no column of it, and no
 * identifying column of sm_architecture_entry, is ever selected.
 */
create or replace function public.sm_architecture_review_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_r       sm_architecture_reviewer%rowtype;
  v_tpl     jsonb;
  v_entries jsonb;
begin
  if coalesce(p_token, '') = '' then return jsonb_build_object('ok', false, 'error', 'missing_token'); end if;

  select * into v_r from sm_architecture_reviewer where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  if v_r.revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;

  select jsonb_build_object(
           'id', t.id, 'name', t.name, 'scale_min', t.scale_min, 'scale_max', t.scale_max,
           'criteria', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', c.id, 'label', c.label, 'description', c.description,
                      'weight', c.weight, 'critical', c.critical)
                    order by c.display_order, c.label)
               from sm_criterion c where c.template_id = t.id), '[]'::jsonb))
    into v_tpl
    from sm_scorecard_template t
   where t.event_id = v_r.event_id and t.competition = 'architecture' and t.is_active
   order by t.version desc limit 1;
  if v_tpl is null then return jsonb_build_object('ok', false, 'error', 'no_template'); end if;

  select coalesce(jsonb_agg(x order by x->>'anon_code'), '[]'::jsonb) into v_entries
  from (
    select jsonb_build_object(
      -- entry_id IS the role assignment id: it is what sm_review keys on and
      -- what the sm26-arch-review edge function expects handed back.
      'entry_id',  ra.id,
      'anon_code', ae.anon_code,
      'category',  ae.category,
      'review', (
        select jsonb_build_object(
                 'status', rvw.status, 'confidence', rvw.confidence, 'coi_flag', rvw.coi_flag,
                 'total_score', rvw.total_score,
                 'scores', coalesce((
                   select jsonb_object_agg(cs.criterion_id::text,
                            jsonb_build_object('score', cs.score, 'comment', cs.comment))
                     from sm_criterion_score cs where cs.review_id = rvw.id), '{}'::jsonb))
          from sm_review rvw
         where rvw.juror_user_id = v_r.juror_user_id
           and rvw.entry_role_assignment_id = ra.id)
    ) as x
    from sm_role_assignment ra
    join sm_registration r on r.id = ra.registration_id
    join sm_architecture_entry ae on ae.role_assignment_id = ra.id
   where ra.event_id = v_r.event_id
     and ra.role like 'architect%'
     and ra.status <> 'declined'
     and r.status not in ('declined', 'cancelled')
     and ae.anon_code is not null
  ) q;

  return jsonb_build_object(
    'ok', true,
    'reviewer', jsonb_build_object('name', v_r.name),
    'template', v_tpl,
    'entries', v_entries);
end $function$;

-- ─── 6. saving a score through the link ─────────────────────────────────────

/**
 * Draft or submit one entry's scorecard. No auth.
 *
 * The weighted total is computed exactly as sm_jury_save_score_by_token does it,
 * so an external reviewer's total_score is directly comparable with an
 * on-platform juror's: each score is taken as a fraction of scale_max, weighted,
 * and divided by the FULL weight of the template — a half-finished draft scores
 * low on purpose, and only a submit is required to be complete.
 */
create or replace function public.sm_architecture_save_score_by_token(
  p_token                    text,
  p_entry_role_assignment_id uuid,
  p_scores                   jsonb,
  p_confidence               int     default null,
  p_coi                      boolean default false,
  p_submit                   boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
        status       = excluded.status,
        total_score  = excluded.total_score,
        submitted_at = excluded.submitted_at,
        updated_at   = now()
  returning id into v_review;

  -- Belt and braces on the invariant that decides whether any of this counts.
  -- sm_architecture_reviewer_add already wrote this row; it is re-asserted here
  -- so an entry that went live (or got its anon_code) after the link was minted
  -- still ranks. Cheap, idempotent, and the failure it prevents is silent.
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

-- ─── 7. who may call what ───────────────────────────────────────────────────
-- The staff three are SECURITY DEFINER, so PUBLIC's default EXECUTE is taken
-- away rather than left to the sm_is_staff() guard alone.
revoke execute on function public.sm_architecture_reviewer_add(uuid, text, text)      from public;
revoke execute on function public.sm_architecture_reviewer_list(uuid)                 from public;
revoke execute on function public.sm_architecture_reviewer_revoke(uuid, boolean)      from public;

grant execute on function public.sm_architecture_reviewer_add(uuid, text, text)  to authenticated, service_role;
grant execute on function public.sm_architecture_reviewer_list(uuid)             to authenticated, service_role;
grant execute on function public.sm_architecture_reviewer_revoke(uuid, boolean)  to authenticated, service_role;

-- The link is the credential, so these two must answer an anonymous caller.
grant execute on function public.sm_architecture_review_by_token(text) to anon, authenticated, service_role;
grant execute on function public.sm_architecture_save_score_by_token(text, uuid, jsonb, int, boolean, boolean)
  to anon, authenticated, service_role;
