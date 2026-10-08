-- newsletter_subscribers: the SMC copy of the website newsletter sign-ups.
-- 8 Oct 2026.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- Newsletter sign-ups from the website go straight to Mailchimp (edge function
-- newsletter-subscribe, single opt-in, welcome e-mail and preference page in
-- Mailchimp). Decision (Victor, 8 Oct 2026, "Mailchimp + copie dans SMC"): the
-- sign-up stays instant in Mailchimp AND each subscriber is also recorded here,
-- so that M3 Financial Ops (the CRM, which pulls SMC data nightly around 03:15 UTC
-- and feeds Mailchimp) can pick them up.
--
-- THIS TABLE IS A COPY READ BY THE CRM, NOT THE SOURCE OF TRUTH. Mailchimp is:
-- it holds the real subscription status (a person who unsubscribes there is NOT
-- updated here), the interests ("Email preferences" group) and the tags. Only
-- people who used a website sign-up form appear here; the rest of the Mailchimp
-- audience does not. The CRM must therefore match contacts by e-mail, never set a
-- person back to "subscribed" because of this table, and read unsubscribes and
-- preference changes from Mailchimp itself (rules written down in the note for
-- Sébastien, "Note CRM - newsletter SMC et Mailchimp.md").
--
-- ════════════════════════════════════════════════════════════════════════════
-- How it is used
-- ════════════════════════════════════════════════════════════════════════════
--   * Written only by the edge function newsletter-subscribe, with the SERVICE
--     ROLE, right after Mailchimp accepted a sign-up (new address, subscribed
--     again, pending address moved to subscribed, or already subscribed). If the
--     write fails it is logged and the visitor still gets the same answer.
--   * Read by the nightly CRM pull (service role) and by verified staff.
--
-- Columns
--   email               the address, lower-cased and trimmed (primary key)
--   source              where the FIRST sign-up came from: footer | home | events |
--                       resources | other | site (same values as the SOURCE merge
--                       field in Mailchimp, which is also only filled once)
--   first_consented_at  the first time this address ticked the consent box on the
--                       website (kept on later sign-ups). Not the date the address
--                       entered Mailchimp by another route (import, CRM)
--   last_signup_at      the latest sign-up through the website form (set again each
--                       time the same address is submitted)
--   mailchimp_status    the status the function saw or set in Mailchimp at that
--                       moment: subscribed | pending. A snapshot, NEVER updated
--                       when the person unsubscribes later: ask Mailchimp
--   tags                the Mailchimp tags the function added over time:
--                       smc-website (welcome trigger) and site-<source>
--   updated_at          last write to the row (use it to pull only what changed)
--
-- ════════════════════════════════════════════════════════════════════════════
-- Access
-- ════════════════════════════════════════════════════════════════════════════
--   - Browsers never write here: RLS on, no INSERT / UPDATE / DELETE policy or
--     grant for anon or authenticated.
--   - anon: no privilege at all.
--   - authenticated: SELECT, and RLS lets only verified staff read:
--     public.is_moderator() = is_verified('admin') OR is_verified('moderator')
--     (see 20261007081437_staff_checks_require_verified_admin and the pattern of
--     20261007211549_contact_submissions).
--   - service_role: SELECT, INSERT, UPDATE, DELETE (DELETE for an erasure request).
--
-- Personal data: the e-mail address and the dates of consent. No IP address is
-- stored here (Mailchimp keeps the sign-up time and IP as its own consent proof).
--
-- No SM26 (sm_*) or WYS (gl_*) object is read or written.
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE,
-- REVOKE / GRANT. Apply BEFORE deploying the new newsletter-subscribe (until
-- then the function logs a failed copy and sign-ups still work).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select to_regclass('public.newsletter_subscribers');                     -- not null
--   select relrowsecurity from pg_class where oid = 'public.newsletter_subscribers'::regclass; -- true
--   select policyname, cmd, roles, qual from pg_policies
--    where tablename = 'newsletter_subscribers';             -- 1 row, SELECT, is_moderator()
--   select has_table_privilege('anon', 'public.newsletter_subscribers', 'select'),           -- false
--          has_table_privilege('authenticated', 'public.newsletter_subscribers', 'insert'),  -- false
--          has_table_privilege('authenticated', 'public.newsletter_subscribers', 'update'),  -- false
--          has_table_privilege('authenticated', 'public.newsletter_subscribers', 'delete'),  -- false
--          has_table_privilege('service_role', 'public.newsletter_subscribers', 'insert');   -- true
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO (loses the copy; Mailchimp is untouched)
-- ════════════════════════════════════════════════════════════════════════════
--   DROP TABLE IF EXISTS public.newsletter_subscribers;

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  email              text        PRIMARY KEY,
  source             text,
  first_consented_at timestamptz NOT NULL DEFAULT now(),
  last_signup_at     timestamptz NOT NULL DEFAULT now(),
  mailchimp_status   text,
  tags               text[]      NOT NULL DEFAULT '{}',
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_subscribers_email_lower  CHECK (email = lower(email)),
  CONSTRAINT newsletter_subscribers_email_len    CHECK (char_length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1),
  CONSTRAINT newsletter_subscribers_source_len   CHECK (source IS NULL OR char_length(source) <= 40),
  CONSTRAINT newsletter_subscribers_status_len   CHECK (mailchimp_status IS NULL OR char_length(mailchimp_status) <= 30),
  CONSTRAINT newsletter_subscribers_tags_size    CHECK (cardinality(tags) <= 50)
);

COMMENT ON TABLE public.newsletter_subscribers IS
  'SMC copy of the website newsletter sign-ups (Mailchimp holds the real status, interests and tags). Written only by the edge function newsletter-subscribe (service role); read by the nightly CRM pull and by verified staff (is_moderator()). The CRM must never use it to re-subscribe anyone. 2026-10-08.';
COMMENT ON COLUMN public.newsletter_subscribers.email IS
  'Address, trimmed and lower-cased by newsletter-subscribe (primary key; match CRM contacts on it).';
COMMENT ON COLUMN public.newsletter_subscribers.source IS
  'Where the FIRST website sign-up came from (footer, home, events, resources, other, site). Same value as the SOURCE merge field in Mailchimp.';
COMMENT ON COLUMN public.newsletter_subscribers.first_consented_at IS
  'First time this address ticked the consent box on the website; kept on later sign-ups.';
COMMENT ON COLUMN public.newsletter_subscribers.last_signup_at IS
  'Latest sign-up through the website form for this address.';
COMMENT ON COLUMN public.newsletter_subscribers.mailchimp_status IS
  'Snapshot of the Mailchimp status seen or set at the latest sign-up (subscribed or pending). Not updated when the person unsubscribes: read Mailchimp for the real status.';
COMMENT ON COLUMN public.newsletter_subscribers.tags IS
  'Mailchimp tags newsletter-subscribe added for this address over time (smc-website, site-<source>).';

-- Incremental pull by the CRM ("what changed since my last run").
CREATE INDEX IF NOT EXISTS newsletter_subscribers_updated_at_idx
  ON public.newsletter_subscribers (updated_at DESC);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Verified staff may read. No INSERT / UPDATE / DELETE policy on purpose: only
-- the service role (which bypasses RLS) writes rows.
DROP POLICY IF EXISTS newsletter_subscribers_staff_select ON public.newsletter_subscribers;
CREATE POLICY newsletter_subscribers_staff_select ON public.newsletter_subscribers
  FOR SELECT TO authenticated
  USING ((SELECT public.is_moderator()));

-- New public tables get ALL for anon/authenticated through Supabase's default
-- privileges: take everything back, then grant only what is needed.
REVOKE ALL ON TABLE public.newsletter_subscribers FROM PUBLIC;
REVOKE ALL ON TABLE public.newsletter_subscribers FROM anon, authenticated;
GRANT SELECT ON TABLE public.newsletter_subscribers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.newsletter_subscribers TO service_role;
