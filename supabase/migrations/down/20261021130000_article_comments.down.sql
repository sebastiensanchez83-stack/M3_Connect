-- DOWN for supabase/migrations/20261021130000_article_comments.sql
-- Removes the article comments: the functions, the four tables (every comment, tag, report and
-- notice is lost: export them first if they matter) and the two comment kinds of
-- notification_outbox (their queued or sent rows are deleted, then the list of kinds is the
-- eight of Phase 3 again). Turn registration_flags.article_comments off first: the pages then
-- show nothing about comments, and with the functions gone they fail quietly into "no comments".
-- Refused while another SQL function still calls one of the functions it drops.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.prosrc ilike '%resource_comment%' or p.prosrc ilike '%resource_comments_%')
     and p.proname not in (
       'resource_comments_on', 'resource_comment_gate', 'resource_comment_staff', 'resource_comment_reader_ok',
       'resource_comment_clean', 'resource_comment_label', 'resource_comment_plain', 'resource_comment_excerpt',
       'resource_comment_prepare', 'resource_comment_recipients', 'resource_comment_notify',
       'resource_comment_post', 'resource_comment_edit', 'resource_comment_delete', 'resource_comment_report',
       'resource_comments_list', 'resource_comment_count', 'resource_comment_mention_search',
       'resource_comment_my_notices', 'resource_comment_mark_seen',
       'admin_resource_comment_moderate', 'admin_resource_comment_reports', 'resource_comment_email');
  if v_bad is not null then
    raise exception 'article_comments down: other SQL function(s) use the comments: %', v_bad;
  end if;
end
$pre$;

drop function if exists
  public.resource_comment_email(bigint),
  public.admin_resource_comment_reports(boolean),
  public.admin_resource_comment_moderate(uuid, text, text),
  public.resource_comment_mark_seen(bigint[]),
  public.resource_comment_my_notices(),
  public.resource_comment_mention_search(text),
  public.resource_comment_count(uuid),
  public.resource_comments_list(uuid),
  public.resource_comment_report(uuid, text),
  public.resource_comment_delete(uuid),
  public.resource_comment_edit(uuid, text),
  public.resource_comment_post(uuid, text),
  public.resource_comment_notify(uuid),
  public.resource_comment_recipients(uuid),
  public.resource_comment_prepare(text),
  public.resource_comment_excerpt(text, integer),
  public.resource_comment_plain(text),
  public.resource_comment_label(text),
  public.resource_comment_clean(text, integer),
  public.resource_comment_reader_ok(uuid, text),
  public.resource_comment_staff(),
  public.resource_comment_gate(uuid, boolean),
  public.resource_comments_on();

drop table if exists public.resource_comment_notice, public.resource_comment_report, public.resource_comment_mention, public.resource_comment;

delete from public.notification_outbox o where o.kind in ('comment_mention', 'comment_report');
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'account_under_review', 'team_join_request',
  'user_account_approved', 'user_account_rejected', 'account_info_requested', 'company_validated',
  'claim_approved', 'claim_declined'));
