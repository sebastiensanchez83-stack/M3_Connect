-- A sign-up can no longer choose a staff persona. handle_new_user keeps a persona
-- from user_metadata only when it is one a visitor may pick for themselves.
--
-- The hole. public.handle_new_user() (AFTER INSERT trigger on_auth_user_created
-- on auth.users) copied raw_user_meta_data->>'persona' into profiles.persona with
-- a plain ::persona_enum cast. user_metadata is whatever the caller of the public
-- sign-up endpoint sends, so
--   supabase.auth.signUp({ email, password, options: { data: { persona: 'admin' } } })
-- created a profile with persona 'admin' and access_status 'pending'. Approving
-- that pending user in Admin > Users only flips access_status to 'verified', and
-- is_admin() / is_moderator() / sm_is_staff() then return true: a full admin.
-- Same for 'moderator'. The deployed claim-code-signup (v9, public) also forwards
-- the visitor's persona into user_metadata unchecked, so it was a second door.
-- The persona is written when the auth.users row is inserted, i.e. at sign-up,
-- whether "Confirm email" is ON or OFF.
--
-- The fix. A metadata persona is kept only if it is a self-service one:
-- marina, partner, media_partner, developer, investor, individual. Anything else
-- ('admin', 'moderator', a typo, a wrong case, an empty or missing value) gets
-- the existing default 'individual'. Before, an unknown value failed the cast and
-- the whole sign-up errored ("Database error saving new user"); it now falls back
-- instead. Staff personas only ever come from an explicit write on profiles
-- (service role in create-admin-user, or an admin in the admin panel).
--
-- Other fields this function takes from metadata: first_name, last_name,
-- job_title. They are display text the user can already edit on their own row.
-- access_status and onboarding_status are the literals 'pending' / 'draft', never
-- read from metadata, and the ON CONFLICT branch does not touch them. email comes
-- from auth.users.email, not from metadata. Nothing else changes in the body.
--
-- Other readers of user_metadata, audited, none grants anything:
--   * get_unconfirmed_users()   shows metadata first/last name and persona in the
--                               "Unconfirmed emails" list of Admin > Users
--                               (display only; a crafted sign-up can still show
--                               the label "admin" there, its profile cannot be one)
--   * sm_account_state_map()    reads pw_pending for the staff SM26 console only
--   * edge functions: send-email (lang, first_name), send-notification and
--     send-status-notification (first_name fallback), sm26-provision welcome_only
--     (pw_pending guard; worst case staff re-sends a set-password link to the
--     user's own address), claim-code-signup (names for the admin notice)
--   * client: AuthRedirector (pw_pending -> /welcome, the user's own session),
--     OnboardingPage / OrganizationTab (company_name, company_website prefill),
--     WelcomePage (first_name). detected_org_id is written by AuthContext.signUp
--     and read nowhere.
--   * no RLS policy reads user_metadata or auth.jwt(); auth.users has no UPDATE
--     trigger, so a later updateUser({ data }) never reaches profiles.
--
-- Callers that create auth users, checked in the repo and against the deployed
-- version:
--   * create-admin-user (v13, same as repo): metadata persona 'admin', then an
--     explicit service-role update persona='admin', access_status='verified',
--     onboarding_status='completed'. Unaffected: the trigger now writes
--     'individual' for the moment before that update. No change needed.
--   * create-demo-user (v7, same as repo): retired stub, answers 410.
--   * sm26-register (v13): 'individual'.
--   * sm26-provision (v6): its own PERSONAS whitelist (no staff persona), then an
--     explicit profile update.
--   * sm26-attendee-invite (v4): 'individual', then an explicit profile update.
--   * sponsor-invite (v2): 'partner', then an explicit profile update.
--   * claim-code-signup: deployed v9 sends the visitor's persona unchecked (closed
--     by this migration); the repo version maps it through SELF_SERVE_PERSONAS.
--     claim_organization_for_user then sets persona to the organization's type
--     when the organization is verified.
--   * sm26-import (v12), sm26-import-up (inert stub), guest-list (v2),
--     admin-impersonate (v3): create no auth user from metadata.
--   * client AuthContext.signUp: SignupForm offers marina, partner, media_partner,
--     developer, investor; JoinPage sends the organization's type (marina,
--     partner, investor today; 'marina' when the type is null). All whitelisted.
--
-- Production at the time of writing (6 Oct 2026): 0 profiles with persona admin
-- or moderator that are not verified (6 verified admins, 0 moderators); 0 auth
-- users whose user_metadata persona is admin or moderator; every auth user has a
-- profile row. Nothing to clean up.
--
-- CREATE OR REPLACE keeps the function's owner (postgres), grants, OID and the
-- on_auth_user_created trigger binding. Signature, return type, language,
-- SECURITY DEFINER and search_path are unchanged.
--
-- Check after applying:
--   select pg_get_functiondef('public.handle_new_user()'::regprocedure);
--
-- UNDO (re-opens self-service admin; do not undo without another guard): put
-- back the previous persona expression, the body being otherwise identical (last
-- applied as 20260307093934_update_handle_new_user_for_job_title):
--     COALESCE(NULLIF(NEW.raw_user_meta_data->>'persona', '')::persona_enum, 'individual'),

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
