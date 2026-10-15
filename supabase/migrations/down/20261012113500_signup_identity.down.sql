-- DOWN for supabase/migrations/20261012113500_signup_identity.sql (part 2 of 2).
-- Run it BEFORE the down of 20261012113000_signup_identity_orgs.
-- Puts back handle_new_user (production md5 7155140f...) and the Phase 1 complete_signup_for
-- placeholder (md5 2baf4cc8...); drops the functions and the tables email_proof_token,
-- signup_claim_code, notification_outbox
-- (unsent e-mails in it are lost: check "select kind, count(*) from notification_outbox
-- where sent_at is null group by 1" first).
-- Kept (valid Phase 1 columns and rows): profiles.signup_source / country / affiliation /
-- signup_intent written at sign-up, profile_interest_sectors rows, join and claim requests
-- in organization_invitations (the down of part 1 cancels the claims). The legacy proof
-- backfill has its own file and down (20261012114000_signup_identity_backfill).

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $pre$
declare
  v_md5 text;
  v_row record;
begin
  for v_row in
    select * from (values
      ('public.handle_new_user()', '7155140fe02bab9470760711b36342fa', '4729540e868841759ad598be8d1a08f1'),
      ('public.complete_signup_for(uuid)', '2baf4cc8093e56ae2541290378f49f69', '67a850075f0e06e93b1ab02a377408ae')
    ) as x(sig, prod, mine)
  loop
    select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_row.sig);
    if v_md5 is distinct from v_row.prod and v_md5 is distinct from v_row.mine then
      raise exception 'signup_identity DOWN: % changed since the up migration (md5 %); restore it by hand', v_row.sig, v_md5;
    end if;
  end loop;
end
$pre$;

-- Production body (owner and ACL kept by CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, persona, first_name, last_name, email, job_title, access_status, onboarding_status)
  VALUES (
    NEW.id,
    -- Self-service personas only; staff personas are never taken from metadata.
    CASE
      WHEN NEW.raw_user_meta_data->>'persona'
           IN ('marina', 'partner', 'media_partner', 'developer', 'investor', 'individual')
        THEN (NEW.raw_user_meta_data->>'persona')::persona_enum
      ELSE 'individual'::persona_enum
    END,
    NULLIF(NEW.raw_user_meta_data->>'first_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'last_name', ''),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'job_title', ''),
    'pending',
    'draft'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, profiles.last_name),
    email = COALESCE(EXCLUDED.email, profiles.email),
    job_title = COALESCE(EXCLUDED.job_title, profiles.job_title),
    persona = CASE WHEN profiles.persona = 'individual' THEN EXCLUDED.persona ELSE profiles.persona END;
  RETURN NEW;
END;
$function$;

-- Phase 1 placeholder (20261009210000_registration_core).
create or replace function public.complete_signup_for(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object('done', false, 'reason', 'not_built_yet')
$function$;
revoke all on function public.complete_signup_for(uuid) from public, anon, authenticated;
grant execute on function public.complete_signup_for(uuid) to service_role;

drop function if exists public.submit_signup_intent(jsonb);
drop function if exists public.complete_my_signup();
drop function if exists public.confirm_email_proof(text);
drop function if exists public.issue_email_proof_token(uuid);
drop function if exists public.notification_outbox_claim(integer, uuid, text[]);
drop function if exists public.notification_outbox_done(bigint, text);
drop function if exists public.signup_intent_clean(jsonb);
drop function if exists public.signup_code_clean(text);
drop table if exists public.notification_outbox;
drop table if exists public.signup_claim_code;
drop table if exists public.email_proof_token;
