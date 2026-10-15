-- DRY RUN of supabase/migrations/20261012114000_signup_identity_backfill.sql. NOT A MIGRATION.
-- ONE query text, ONE execute_sql call, after 20261009210000_registration_core (parts 1 and 2
-- of signup_identity are not needed). Snapshot, the migration verbatim, then checks. Ends
-- with RAISE EXCEPTION 'DRYRUN ...'; everything rolls back. B01 prints how many accounts the
-- file would stamp today, per method; B07 compares them with the spec §5 rule read
-- independently before the migration. It holds a lock on profiles (DISABLE TRIGGER) until
-- the final rollback (a few seconds): run it off-peak.
-- Expected: "7 PASS, 0 FAIL", B01 "47 account(s) stamped (methods: magiclink 24, otp 19,
-- recovery 4) ..." as read on 15 Oct 2026 (the count moves as sessions end or start; B07
-- prints the independent count, which must be the same).

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
-- The rule of spec §5 as Victor chose it (15 Oct 2026), written apart from the migration:
-- an unproven account, never asked for an e-mail change, profiles.email = auth e-mail, with
-- a session opened from any e-mail link after the account was created, after the last
-- e-mail change and after the impersonation log began, not within -5/+1 minutes of an admin
-- "view as user". B07: the migration stamps exactly these accounts.
create temp table _dr_expect on commit drop as
  select u.id as user_id
    from auth.users u
    join public.profiles p on p.user_id = u.id
   where p.email_proven_at is null
     and u.email_change_sent_at is null
     and lower(p.email) = lower(u.email)
     and exists (select 1
                   from auth.mfa_amr_claims c
                   join auth.sessions s on s.id = c.session_id
                  where s.user_id = u.id
                    and c.authentication_method in ('otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change')
                    and c.created_at >= u.created_at
                    and (p.email_changed_at is null or c.created_at >= p.email_changed_at)
                    and c.created_at >= (select min(i.created_at) from public.admin_impersonation_log i)
                    and not exists (select 1 from public.admin_impersonation_log i
                                     where i.target_user_id = u.id
                                       and i.created_at between c.created_at - interval '5 minutes' and c.created_at + interval '1 minute'));

-- ─── B. The migration, verbatim ───────────────────────────────────────────────
-- Unified registration, Phase 2 (DB lane): legacy e-mail proof backfill (spec §5).
-- Contract: docs/registration-contract.md §10.7.
-- NOT APPLIED. Rule chosen by Victor on 15 Oct 2026 (below): run the dry run, then apply.
-- Needs only 20261009210000_registration_core: it does not depend on 20261012113000 /
-- 20261012113500, nor they on it. After any change to v_methods, rebuild the dry runs.
-- Down: supabase/migrations/down/20261012114000_signup_identity_backfill.down.sql.
-- Dry run: supabase/dryrun/20261012114000_signup_identity_backfill.dryrun.sql (+ .down.dryrun).
--
-- The rule (spec §5, Victor 15 Oct 2026): email_proven_at is stamped only where auth data
-- proves a later sign-in from ANY e-mail link sent to the account's current address:
-- v_methods = every e-mail-link method mark_email_proven knows (otp, magiclink, recovery,
-- invite, email/signup, email_change). 47 accounts on 15 Oct 2026, each stamped with its
-- latest such session: 24 magiclink, 19 otp, 4 recovery (43 of the 47 on magic-link or
-- one-time-code sessions only); 34 more had e-mail-link sessions only around an admin "view
-- as user" and are left unproven. The number moves while this waits (ended sessions drop
-- out of the evidence; main still offers magic-link sign-in). Accepted on purpose: a link
-- proves the inbox, not that the password is the person's (Confirm email has been off since
-- May: anyone could create an account with another person's address and keep its
-- password), which mark_email_proven guards against by stamping only once a new password is
-- saved. Not chosen: recovery sessions only (4 accounts). Everyone not stamped proves the
-- address with the dashboard banner (/verify-email, signed in with the password) or by
-- choosing a new password.
--
-- What a stamp changes at once, on the live main site too: get_my_event_access (main's
-- dashboard and event page) counts a confirmed gl_guest row of the PROVEN address;
-- gl_guest_engine_guard keeps user_id on a new WYS row only for a proven account;
-- my_participations and attach_my_records (the redesign) read by the proven address, and
-- mark_email_proven (redesign /welcome, /reset-password) attaches records when already
-- proven. On 15 Oct 2026 no unlinked gl_guest, sm_attendee or legacy guest
-- event_registrations row and no pending_link job matched the 47 accounts' addresses.
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
  -- Victor's choice (15 Oct 2026): every e-mail-link method (spec §5); see the header.
  v_methods constant text[] := array['otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change'];
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

-- ─── C. Checks ────────────────────────────────────────────────────────────────
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
    ('B01', format('%s account(s) stamped (methods: %s), each logged once in review_log with its stamp, address = auth e-mail = profiles.email',
       (select count(*) from public.review_log l where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000'),
       coalesce((select string_agg(z.m || ' ' || z.k, ', ' order by z.m) from (select l.details ->> 'method' as m, count(*) as k from public.review_log l where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000' group by 1) z), 'none')),
     $q$select count(*) = count(distinct l.subject_id) and coalesce(bool_and(pr.email_proven_at = (l.details ->> 'stamped_at')::timestamptz and lower(pr.email) = lower(u.email)), true) from public.review_log l join public.profiles pr on pr.user_id = l.subject_id join auth.users u on u.id = l.subject_id where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000'$q$),
    ('B02', 'evidence: a session of the logged method at the stamped time, none within an admin "view as user"',
     $q$select coalesce(bool_and(exists (select 1 from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id where s.user_id = l.subject_id and c.created_at = (l.details ->> 'stamped_at')::timestamptz and c.authentication_method = l.details ->> 'method' and not exists (select 1 from public.admin_impersonation_log i where i.target_user_id = s.user_id and i.created_at between c.created_at - interval '5 minutes' and c.created_at + interval '1 minute'))), true) from public.review_log l where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000'$q$),
    ('B03', 'no stamped account ever asked for an e-mail change',
     $q$select not exists (select 1 from public.review_log l join auth.users u on u.id = l.subject_id where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000' and u.email_change_sent_at is not null)$q$),
    ('B04', 'proven accounts = before + the logged ones, nothing else',
     $q$select not exists ((select pr.user_id from public.profiles pr where pr.email_proven_at is not null) except ((select b.user_id from _dr_proven b) union all (select l.subject_id from public.review_log l where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000'))) and not exists (select 1 from _dr_proven b join public.profiles pr on pr.user_id = b.user_id where pr.email_proven_at is distinct from b.email_proven_at)$q$),
    ('B05', 'trg_profiles_updated_at enabled again',
     $q$select tgenabled = 'O' from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_profiles_updated_at'$q$),
    ('B06', 'snapshot = before (SM26, gl_guest, invitations, companies, members, profiles with updated_at, policies, ACLs)',
     $q$select count(*) = (select count(*) from _dr_before) and bool_and(b.v = a.v) from _dr_before b join pg_temp.dr_snap() a on a.k = b.k$q$),
    ('B07', format('stamped accounts = the spec §5 rule read before the migration (%s account(s); 47 on 15 Oct 2026)',
       (select count(*) from _dr_expect)),
     $q$select not exists ((select e.user_id from _dr_expect e) except (select l.subject_id from public.review_log l where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000')) and not exists ((select l.subject_id from public.review_log l where l.action = 'email_proof_backfill' and l.details ->> 'migration' = '20261012114000') except (select e.user_id from _dr_expect e))$q$)
  ) x(id, label, q)
  loop
    v_err := null;
    begin
      execute v_c.q into v_ok;
    exception when others then
      v_ok := false; v_err := sqlerrm;
    end;
    if coalesce(v_ok, false) then n_pass := n_pass + 1; else n_fail := n_fail + 1; end if;
    results := results || format(E'\n%s %s: %s%s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end,
                                 v_c.id, v_c.label, coalesce(' | error ' || v_err, ''));
  end loop;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (signup_identity_backfill, run %s)', n_pass, n_fail, now()) || results;
end
$after$;
