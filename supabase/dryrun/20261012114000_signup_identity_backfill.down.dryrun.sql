-- DRY RUN of the DOWN of supabase/migrations/20261012114000_signup_identity_backfill.sql. NOT A
-- MIGRATION. ONE query text, ONE execute_sql call, after 20261009210000_registration_core.
-- Snapshot, the migration verbatim, one backfilled account proven again later (its newer
-- proof must survive the down), the down verbatim, then checks that production is back:
-- e-mail proofs as before but the re-proven one, review_log rows gone, updated_at untouched
-- (snapshot). Ends with RAISE EXCEPTION 'DRYRUN ...'; everything rolls back. Off-peak (lock
-- on profiles until the rollback). Expected: "5 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot (read again after the migration: must be identical) ─────────
-- A pending invitation past its expiry is read as 'expired' (part 1 sets it so).
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'acl ' || p.oid::regprocedure::text, coalesce(p.proacl::text, '') || ' ' || pg_get_userbyid(p.proowner)
    from pg_proc p
   where p.oid in ('public.accept_org_invitation(uuid)'::regprocedure, 'public.claim_organization(text)'::regprocedure,
                   'public.claim_organization_for_user(uuid,text)'::regprocedure, 'public.reject_join_request(uuid)'::regprocedure,
                   'public.approve_join_request(uuid)'::regprocedure, 'public.check_pending_invitation(text)'::regprocedure, 'public.handle_new_user()'::regprocedure,
                   'public.complete_signup_for(uuid)'::regprocedure, 'public.request_org_join(uuid)'::regprocedure,
                   'public.create_organization(text,text,text,text,text,text,text)'::regprocedure)
  union all select 'sm26', md5(concat_ws('|',
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_registration x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_role_assignment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_attendee x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_badge x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_payment x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_invoice x),
      (select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from public.sm_networking_pass x)))
  union all select 'gl_guest', (select md5(coalesce(string_agg(g.id::text || g.token::text || g.status, ',' order by g.id), '')) from public.gl_guest g)
  union all select 'invitations', (select md5(coalesce(string_agg(i.id::text || case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end || i.email || i.expires_at::text, ',' order by i.id), '')) from public.organization_invitations i)
  union all select 'orgs', (select md5(coalesce(string_agg(o.id::text || o.name || coalesce(o.access_status, '') || coalesce(o.owner_user_id::text, ''), ',' order by o.id), '')) from public.organizations o)
  union all select 'members', (select md5(coalesce(string_agg(m.id::text || m.user_id::text || m.role, ',' order by m.id), '')) from public.organization_members m)
  union all select 'profiles', (select md5(coalesce(string_agg(pr.user_id::text || pr.access_status::text || pr.onboarding_status::text || pr.persona::text || pr.updated_at::text, ',' order by pr.user_id), '')) from public.profiles pr)
  union all select 'other_policies', (select md5(string_agg(format('%s|%s|%s|%s|%s', pl.tablename, pl.policyname, pl.cmd, pl.qual, pl.with_check), ';' order by pl.tablename, pl.policyname))
                                        from pg_policies pl where pl.schemaname = 'public'
                                         and pl.tablename in ('organization_invitations', 'organization_members', 'profiles', 'organizations')
                                         and pl.policyname <> 'owners_can_create_invitations')
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();
create temp table _dr_proven on commit drop as
  select pr.user_id, pr.email_proven_at from public.profiles pr where pr.email_proven_at is not null;

-- ─── B. The migration, verbatim ───────────────────────────────────────────────
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

-- ─── C. A backfilled account proven again later ──────────────────────────────
alter table public.profiles disable trigger trg_profiles_updated_at;
select set_config('dr.kept', coalesce((select l.subject_id::text from public.review_log l
   where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000' order by l.id limit 1), ''), true);
update public.profiles set email_proven_at = email_proven_at + interval '1 second' where user_id::text = current_setting('dr.kept');
alter table public.profiles enable trigger trg_profiles_updated_at;

-- ─── D. The DOWN, verbatim ────────────────────────────────────────────────────
-- DOWN for supabase/migrations/20261012114000_signup_identity_backfill.sql.
-- Unstamps exactly the legacy e-mail proofs this migration stamped: rows whose
-- email_proven_at is still the value it wrote (an account proven again since, by
-- mark_email_proven or confirm_email_proof, keeps its newer proof); then deletes its
-- review_log rows ('email_proof_backfill', details.migration '20261012114000').
-- updated_at untouched. Kept on purpose (not undone): records attached to these accounts
-- while they were proven (attach_my_records, mark_email_proven, gl_guest user_id kept by
-- gl_guest_engine_guard) and provisioning jobs it put back in the queue (they may have run).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $unstamp$
declare
  v_n integer;
  v_r integer;
begin
  alter table public.profiles disable trigger trg_profiles_updated_at;
  update public.profiles pr
     set email_proven_at = null
    from public.review_log l
   where l.subject_type = 'person' and l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000'
     and pr.user_id = l.subject_id
     and pr.email_proven_at = (l.details ->> 'stamped_at')::timestamptz;
  get diagnostics v_n = row_count;
  alter table public.profiles enable trigger trg_profiles_updated_at;
  delete from public.review_log l
   where l.subject_type = 'person' and l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000';
  get diagnostics v_r = row_count;
  raise notice 'signup_identity_backfill DOWN: legacy e-mail proof removed from % account(s), % review_log row(s) deleted', v_n, v_r;
end
$unstamp$;

-- ─── E. After the down ────────────────────────────────────────────────────────
do $after$
declare
  results text := '';
  n_pass integer := 0;
  n_fail integer := 0;
  v_c record;
  v_ok boolean;
  v_err text;
begin
  for v_c in select * from (values
    ('D01', 'backfill undone exactly: e-mail proofs = before, except the account proven again since',
     $q$select not exists ((select pr.user_id, pr.email_proven_at from public.profiles pr where pr.email_proven_at is not null and pr.user_id::text <> current_setting('dr.kept')) except (select b.user_id, b.email_proven_at from _dr_proven b)) and not exists ((select b.user_id, b.email_proven_at from _dr_proven b) except (select pr.user_id, pr.email_proven_at from public.profiles pr where pr.email_proven_at is not null))$q$),
    ('D02', 'the account proven again since keeps its proof (none backfilled: skipped)',
     $q$select current_setting('dr.kept') = '' or exists (select 1 from public.profiles where user_id::text = current_setting('dr.kept') and email_proven_at is not null)$q$),
    ('D03', 'review_log rows of the backfill removed',
     $q$select not exists (select 1 from public.review_log where action = 'email_proof_backfill' and details ->> 'migration' = '20261012114000')$q$),
    ('D04', 'trg_profiles_updated_at enabled again',
     $q$select tgenabled = 'O' from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_profiles_updated_at'$q$),
    ('D05', 'snapshot = before (SM26, gl_guest, invitations, companies, members, profiles with updated_at, policies, ACLs)',
     $q$select count(*) = (select count(*) from _dr_before) and bool_and(b.v = a.v) from _dr_before b join pg_temp.dr_snap() a on a.k = b.k$q$)
  ) x(id, label, q)
  loop
    v_err := null;
    begin
      execute v_c.q into v_ok;
    exception when others then
      v_ok := false; v_err := sqlerrm;
    end;
    if coalesce(v_ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s down: %s%s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end,
                                 v_c.id, v_c.label, coalesce(' | error ' || v_err, ''));
  end loop;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (signup_identity_backfill DOWN, run %s)', n_pass, n_fail, now()) || results;
end
$after$;
