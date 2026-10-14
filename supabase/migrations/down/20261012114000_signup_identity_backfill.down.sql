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
