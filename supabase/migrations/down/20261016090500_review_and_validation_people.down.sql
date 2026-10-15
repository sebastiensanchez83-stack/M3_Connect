-- DOWN for supabase/migrations/20261016090500_review_and_validation_people.sql
-- Drops M3's decision RPCs. Decisions already taken stay (people verified, companies created,
-- claims decided), with their review_log rows; decision e-mails still unsent stay queued in
-- notification_outbox (the drain sends or skips them; delete them by hand to cancel them).
-- Refused while the held go-live file signup_identity_golive.sql is applied: it revoked
-- create_organization from members, so admin_validate_person is then M3's only way to
-- create a company.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
begin
  if to_regprocedure('public.create_organization(text,text,text,text,text,text,text)') is not null
     and not has_function_privilege('authenticated', 'public.create_organization(text,text,text,text,text,text,text)', 'execute') then
    raise exception 'down people: the held signup_identity_golive.sql is applied; run its down first';
  end if;
end
$pre$;

drop function if exists public.admin_review_dismiss(text, uuid, uuid, text);
drop function if exists public.admin_revoke_team_join(uuid, boolean, text);
drop function if exists public.admin_decide_claim(uuid, boolean, text);
drop function if exists public.admin_approve_person(uuid, boolean);
drop function if exists public.admin_validate_person(uuid, jsonb);
drop function if exists public.review_skip_under_review_mail(uuid);
drop function if exists public.review_display_persona(uuid, uuid);
