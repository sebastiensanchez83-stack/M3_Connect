-- Applied to the remote project via the Supabase MCP; kept here for traceability.
--
-- Feedback without an account: full name + email.
--
-- The questionnaire was built for people who hold a platform account:
-- sm_feedback_response.user_id is NOT NULL and its RLS policy is
-- user_id = auth.uid(). That was fine when every participant registered
-- themselves. It is not fine for SM26 as it actually happened: 149 of the 245
-- people on site were imported from the organiser's own list the night before
-- and have no account at all, and another 98 have no email either. Asking them
-- to create an account to say how the event went loses most of the answers.
--
-- So a second, anonymous door: type your first name, last name and email, and
-- answer. The row carries no user_id; it is keyed on the email instead, so a
-- second submission from the same address revises the first rather than
-- doubling it. When that email matches somebody on the attendee list the row is
-- linked to them (attendee_id), which is what lets the admin report keep
-- showing company, roles and whether they were scanned in.
--
-- Writing stays impossible from the table: the anon grant is on one
-- SECURITY DEFINER function, which validates, resolves the attendee and caps
-- the payload. RLS on sm_feedback_response is untouched, so a participant still
-- cannot read anyone else's answers.

alter table public.sm_feedback_response alter column user_id drop not null;
alter table public.sm_feedback_response add column if not exists respondent_name text;
alter table public.sm_feedback_response add column if not exists respondent_email text;
alter table public.sm_feedback_response add column if not exists attendee_id uuid references public.sm_attendee(id) on delete set null;

comment on column public.sm_feedback_response.respondent_email is
  'Set only for answers given without an account. One row per address per event (partial unique index), so re-answering revises.';

-- One answer per address, but only for the account-less rows: the account rows
-- keep their own unique (event_id, user_id).
create unique index if not exists sm_feedback_response_public_uq
  on public.sm_feedback_response (event_id, lower(respondent_email))
  where user_id is null;

create or replace function public.sm_feedback_submit_public(
  p_first text, p_last text, p_email text, p_answers jsonb)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event uuid; v_email text; v_name text; v_att uuid; v_existing uuid;
begin
  select e.id into v_event from sm_event e where e.slug = 'sm26';
  if v_event is null then return jsonb_build_object('ok', false, 'error', 'no_event'); end if;

  v_name := nullif(btrim(regexp_replace(coalesce(p_first, '') || ' ' || coalesce(p_last, ''), '\s+', ' ', 'g')), '');
  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  if nullif(btrim(coalesce(p_first, '')), '') is null or nullif(btrim(coalesce(p_last, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'need_first_and_last_name');
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160 then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or p_answers = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'no_answers');
  end if;
  -- A questionnaire answer is a few kilobytes; anything larger is not feedback.
  if length(p_answers::text) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;

  -- If we know this address, keep the link: the report then still shows their
  -- company, their roles and whether they were scanned in.
  select a.id into v_att
    from sm_attendee a
   where a.event_id = v_event and lower(btrim(a.email)) = v_email
   order by a.attending desc, a.created_at
   limit 1;

  -- An account holder who typed their own address here would otherwise create a
  -- second, competing row. Send them to the signed-in answer instead.
  select fr.id into v_existing from sm_feedback_response fr
    join profiles p on p.user_id = fr.user_id
   where fr.event_id = v_event and lower(p.email) = v_email
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'error', 'already_answered_signed_in');
  end if;

  insert into sm_feedback_response (event_id, user_id, attendee_id, respondent_name, respondent_email, answers, submitted_at)
  values (v_event, null, v_att, left(v_name, 120), v_email, p_answers, now())
  on conflict (event_id, lower(respondent_email)) where user_id is null
    do update set answers = excluded.answers, submitted_at = now(),
                  respondent_name = excluded.respondent_name,
                  attendee_id = coalesce(excluded.attendee_id, sm_feedback_response.attendee_id);

  return jsonb_build_object('ok', true, 'known_attendee', v_att is not null);
end $function$;

revoke execute on function public.sm_feedback_submit_public(text, text, text, jsonb) from public;
grant execute on function public.sm_feedback_submit_public(text, text, text, jsonb) to anon, authenticated, service_role;

-- The admin reader has to carry the account-less rows too, or the answers are
-- collected and never read. Identity resolves through the attendee link when
-- there is one; `no_account` marks where the answer came from.
drop function if exists public.sm_feedback_responses_admin(uuid);
create or replace function public.sm_feedback_responses_admin(p_event_id uuid)
returns table(user_id uuid, name text, company text, email text, country text, roles text,
              paid boolean, attended boolean, answers jsonb, submitted_at timestamptz, no_account boolean)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not sm_is_staff() then raise exception 'Not authorized'; end if;
  return query
  select fr.user_id,
         case when fr.user_id is null
              then coalesce(nullif(trim(fr.respondent_name), ''),
                            nullif(trim(coalesce(att.first_name, '') || ' ' || coalesce(att.last_name, '')), ''),
                            fr.respondent_email, 'Participant')
              else coalesce(nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
                            nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
                            p.email, 'Participant')
         end,
         coalesce(nullif(trim(r.company_name), ''), '—'),
         coalesce(nullif(trim(fr.respondent_email), ''), nullif(trim(r.email), ''), p.email),
         r.country,
         (select string_agg(distinct ra.role, ', ' order by ra.role)
            from sm_role_assignment ra
           where ra.registration_id = r.id and ra.status <> 'declined'),
         (select pay.status in ('paid', 'waived') from sm_payment pay where pay.registration_id = r.id),
         (exists (select 1 from sm_attendee a join sm_checkin c on c.attendee_id = a.id where a.registration_id = r.id)
          or exists (select 1 from sm_checkin c2 where c2.attendee_id = fr.attendee_id)),
         fr.answers, fr.submitted_at,
         fr.user_id is null
    from sm_feedback_response fr
    left join profiles p on p.user_id = fr.user_id
    left join sm_attendee att on att.id = fr.attendee_id
    -- A person may hold more than one registration; take the live one. For an
    -- account-less answer the registration comes through the attendee link.
    left join lateral (
      select r2.* from sm_registration r2
       where r2.event_id = fr.event_id and r2.status not in ('cancelled', 'declined')
         and ((fr.user_id is not null and r2.user_id = fr.user_id)
              or (fr.user_id is null and att.registration_id = r2.id))
       order by r2.created_at limit 1
    ) r on true
   where fr.event_id = p_event_id
   order by fr.submitted_at desc;
end $function$;

revoke execute on function public.sm_feedback_responses_admin(uuid) from public, anon;
grant execute on function public.sm_feedback_responses_admin(uuid) to authenticated, service_role;
