-- DOWN of supabase/migrations/20261021175000_market_requests.sql.
-- Removes what it added: the eight functions, the queued or sent status e-mails of
-- notification_outbox (kind 'market_request_status') and the history of the marina requests in
-- review_log (subject_type 'market_request': status changes, corrections and notes are lost;
-- export them first if they matter), then puts both lists back as they were. The statuses and the
-- corrected texts of the requests themselves stay as they are now.
-- Refused while another SQL function still names one of the functions it drops, or while another
-- file has widened one of the two lists since (merge the lists first).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
  v_def text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.prosrc ilike '%market_request_%' or p.prosrc ilike '%admin_market_request%')
     and p.proname not in (
       'market_request_statuses', 'market_request_mails', 'market_request_emails_on', 'market_request_row',
       'admin_market_request_set_status', 'admin_market_request_edit', 'admin_market_request_note', 'market_request_email');
  if v_bad is not null then
    raise exception 'market_requests down: other SQL function(s) use these functions: %', v_bad;
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'notification_outbox_kind_check' and c.conrelid = 'public.notification_outbox'::regclass;
  if v_def is distinct from 'CHECK ((kind = ANY (ARRAY[''account_under_review''::text, ''team_join_request''::text, ''user_account_approved''::text, ''user_account_rejected''::text, ''account_info_requested''::text, ''company_validated''::text, ''claim_approved''::text, ''claim_declined''::text, ''comment_mention''::text, ''comment_report''::text, ''market_request_status''::text])))' then
    raise exception 'market_requests down: notification_outbox kinds changed since (%); merge the lists in this file', v_def;
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'review_log_subject_type_check' and c.conrelid = 'public.review_log'::regclass;
  if v_def is distinct from 'CHECK ((subject_type = ANY (ARRAY[''person''::text, ''company''::text, ''registration''::text, ''claim''::text, ''join''::text, ''merge''::text, ''market_request''::text])))' then
    raise exception 'market_requests down: review_log subject types changed since (%); merge the lists in this file', v_def;
  end if;
end
$pre$;

drop function if exists
  public.market_request_email(bigint),
  public.admin_market_request_note(text, uuid, text),
  public.admin_market_request_edit(text, uuid, jsonb),
  public.admin_market_request_set_status(text, uuid, text, text, boolean),
  public.market_request_row(text, uuid),
  public.market_request_emails_on(),
  public.market_request_mails(text, text),
  public.market_request_statuses(text);

delete from public.notification_outbox o where o.kind = 'market_request_status';
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'account_under_review', 'team_join_request',
  'user_account_approved', 'user_account_rejected', 'account_info_requested', 'company_validated',
  'claim_approved', 'claim_declined',
  'comment_mention', 'comment_report'));

delete from public.review_log l where l.subject_type = 'market_request';
alter table public.review_log drop constraint review_log_subject_type_check;
alter table public.review_log add constraint review_log_subject_type_check check (subject_type in (
  'person', 'company', 'registration', 'claim', 'join', 'merge'));
