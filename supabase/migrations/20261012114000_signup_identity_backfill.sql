-- Unified registration, Phase 2 (DB lane): legacy e-mail proof backfill (spec §5).
-- Contract: docs/registration-contract.md §10.7.
-- NOT APPLIED. HOLD until Victor has chosen which sessions count (v_methods below; after a
-- change, rebuild the dry run). Needs only 20261009210000_registration_core: it does not
-- depend on 20261012113000 / 20261012113500, nor they on it.
-- Down: supabase/migrations/down/20261012114000_signup_identity_backfill.down.sql.
-- Dry run: supabase/dryrun/20261012114000_signup_identity_backfill.dryrun.sql (+ .down.dryrun).
--
-- The choice (counts read on 15 Oct 2026; ended sessions drop out of the evidence, so the
-- numbers only go down while this waits):
--   array['recovery'] (THIS FILE): a "Forgot password?" link of this address was opened,
--     the flow in which a new password is saved: the nearest to the Phase 1 rule (proof only
--     once a new password is chosen from an e-mailed link). 4 accounts.
--   array['otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change']: the
--     spec's wording, "a sign-in from an e-mail link". 47 accounts, 43 of them on magic-link
--     or one-time-code sign-ins only: a link proves the inbox, not that the password is the
--     person's (Confirm email has been off since May: anyone could create an account with
--     another person's address and keep its password).
--   Not applying it: everyone else proves the address with the dashboard banner
--     (/verify-email, signed in with the password) or by choosing a new password.
--
-- What a stamp changes at once, on the live main site too: get_my_event_access (main's
-- dashboard and event page) counts a confirmed gl_guest row of the PROVEN address;
-- gl_guest_engine_guard keeps user_id on a new WYS row only for a proven account;
-- my_participations and attach_my_records (the redesign) read by the proven address, and
-- mark_email_proven (redesign /welcome, /reset-password) attaches records when already
-- proven. On 15 Oct 2026 no unlinked gl_guest row and no pending_link job matched these
-- accounts.
--
-- Evidence: auth.audit_log_entries is EMPTY in this project (0 rows; GoTrue's audit trail
-- goes to the log service), so the spec's source proves nothing. auth.mfa_amr_claims keeps
-- the amr of every live session (what mark_email_proven reads from the JWT). Stamped: a
-- session opened by one of v_methods after the account was created and after the last
-- e-mail change, the address being both the auth e-mail and profiles.email; never an account
-- that ever asked for an e-mail change (auth.users.email_change_sent_at, which also covers
-- changes made before profiles.email_changed_at existed); not within -5/+1 minutes of an
-- admin "view as user" (admin_impersonation_log), and only since that log exists (11 Jul
-- 2026: an older magic link may be an unlogged impersonation).
-- email_proven_at = that session's time; updated_at is left alone (send-profile-reminders
-- reads it). One review_log row per stamped account (action 'email_proof_backfill',
-- details {stamped_at, method, migration}): the down script unstamps exactly those still
-- carrying that stamp. As on_email_proven, the person's provisioning jobs left 'pending_link'
-- for that address go back to 'queued' (count printed). attach_my_records_for and
-- complete_signup_for are not run here.
-- Locks: profiles (DISABLE TRIGGER) until the end of the transaction; apply off-peak.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regprocedure('public.on_email_proven(uuid)') is null
     or to_regclass('public.review_log') is null
     or to_regclass('public.admin_impersonation_log') is null
     or to_regclass('public.account_provision_job') is null then
    raise exception 'signup_identity_backfill: apply 20261009210000_registration_core first';
  end if;
  if exists (select 1 from public.review_log l
              where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000') then
    raise exception 'signup_identity_backfill: already applied (review_log rows of 20261012114000 exist)';
  end if;
end
$pre$;

do $backfill$
declare
  -- Victor's choice: see the header.
  v_methods constant text[] := array['recovery'];
  v_n integer;
  v_q integer;
begin
  alter table public.profiles disable trigger trg_profiles_updated_at;
  with lg as (select min(l.created_at) as since from public.admin_impersonation_log l),
  ev as (
    select s.user_id, max(c.created_at) as at_,
           (array_agg(c.authentication_method order by c.created_at desc))[1] as method
      from auth.mfa_amr_claims c
      join auth.sessions s on s.id = c.session_id
      join auth.users u on u.id = s.user_id
      join public.profiles pr on pr.user_id = s.user_id
      cross join lg
     where c.authentication_method = any (v_methods)
       and c.created_at >= coalesce(lg.since, 'infinity'::timestamptz)
       and c.created_at >= u.created_at
       and u.email_change_sent_at is null
       and (pr.email_changed_at is null or c.created_at >= pr.email_changed_at)
       and lower(pr.email) = lower(u.email)
       and pr.email_proven_at is null
       and not exists (select 1 from public.admin_impersonation_log l
                        where l.target_user_id = s.user_id
                          and l.created_at between c.created_at - interval '5 minutes' and c.created_at + interval '1 minute')
     group by s.user_id
  ),
  st as (
    update public.profiles pr
       set email_proven_at = ev.at_
      from ev
     where pr.user_id = ev.user_id and pr.email_proven_at is null
    returning pr.user_id, pr.email_proven_at, ev.method
  )
  insert into public.review_log (subject_type, subject_id, action, note, details)
  select 'person', st.user_id, 'email_proof_backfill',
         'Legacy e-mail proof (migration 20261012114000_signup_identity_backfill): a session opened from an e-mail link sent to this address.',
         jsonb_build_object('stamped_at', st.email_proven_at, 'method', st.method, 'migration', '20261012114000')
    from st;
  get diagnostics v_n = row_count;
  alter table public.profiles enable trigger trg_profiles_updated_at;

  -- as on_email_proven: a confirmed registration of the address just proved, left
  -- 'pending_link' by provision-person, goes back to the provisioning queue.
  update public.account_provision_job j
     set status = 'queued', done_at = null, last_error = null, attempts = 0
    from public.gl_guest g, public.review_log l, auth.users u
   where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000'
     and u.id = l.subject_id
     and j.source_kind = 'gl_guest'
     and j.source_id = g.id
     and j.status = 'done'
     and g.status = 'confirmed'
     and g.account_action = 'pending_link'
     and (g.user_id = l.subject_id or g.user_id is null)
     and lower(g.email) = lower(u.email);
  get diagnostics v_q = row_count;
  raise notice 'signup_identity_backfill: legacy e-mail proof stamped for % account(s) (methods %); % provisioning job(s) re-queued',
    v_n, array_to_string(v_methods, ', '), v_q;
end
$backfill$;
