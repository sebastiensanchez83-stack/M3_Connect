-- Public contact form (/contact): the table it has always tried to write to.
-- Hotfix, 7 Oct 2026.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Why
-- ════════════════════════════════════════════════════════════════════════════
-- src/pages/ContactPage.tsx inserted into public.contact_submissions, a table that
-- never existed (to_regclass('public.contact_submissions') is null in production
-- on 7 Oct 2026). Every submission failed, the page then opened the visitor's
-- mail client (mailto:contact@smartmarinaconnect.com) and showed "Thank you"
-- whether or not the visitor actually sent anything: messages were lost.
-- Decision (Victor, 7 Oct 2026): every message is stored AND e-mailed to
-- events@m3monaco.com, and the visitor sees "thank you" only when it went through.
--
-- How it is used
--   The page posts to the edge function contact-submit (verify_jwt false). The
--   function validates and trims the fields, drops honeypot hits, rate-limits
--   (per hashed IP and per e-mail address, counted on this table), inserts here
--   with the SERVICE ROLE, then e-mails the inbox through Resend and sets
--   emailed_at. The visitor gets 200 { ok: true } only once Resend accepted the
--   e-mail. If the insert fails, or the e-mail fails, the visitor gets an error
--   (500) and the page's error box with events@m3monaco.com; in the second case
--   the row is kept (emailed_at stays null), and a retry adds a second row.
--
-- Access
--   - Browsers never write here: RLS on, and no INSERT / DELETE policy or grant
--     for anon or authenticated. Only the service role (the edge function) inserts.
--   - anon: no privilege at all.
--   - authenticated: SELECT, and UPDATE of (status, handled_at, handled_by) only;
--     RLS lets only verified staff use them: public.is_moderator() =
--     is_verified('admin') OR is_verified('moderator') (see
--     20261007081437_staff_checks_require_verified_admin).
--   - service_role: SELECT (rate-limit counts), INSERT, UPDATE (emailed_at),
--     DELETE (a row refused as over the limit right after it was written).
--
-- Personal data: name, e-mail, company and the message are what the visitor typed.
-- ip_hash is an HMAC-SHA-256 of the caller's IP under a server secret, never the
-- IP itself. user_agent is kept (500 characters max) to help spot spam.
--
-- The length limits below mirror the function's validation (characters, i.e.
-- code points, as char_length counts them). subject has no list here on purpose:
-- the allowed values live in the function, so adding one never makes the insert
-- fail.
--
-- No SM26 (sm_*) or WYS (gl_*) object is read or written.
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE,
-- REVOKE / GRANT.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select to_regclass('public.contact_submissions');                     -- not null
--   select relrowsecurity from pg_class where oid = 'public.contact_submissions'::regclass; -- true
--   select policyname, cmd, roles, qual, with_check from pg_policies
--    where tablename = 'contact_submissions';                            -- 2 rows, is_moderator()
--   select has_table_privilege('anon', 'public.contact_submissions', 'select'),           -- false
--          has_table_privilege('anon', 'public.contact_submissions', 'insert'),           -- false
--          has_table_privilege('authenticated', 'public.contact_submissions', 'insert'),  -- false
--          has_table_privilege('authenticated', 'public.contact_submissions', 'delete'),  -- false
--          has_column_privilege('authenticated', 'public.contact_submissions', 'message', 'update'), -- false
--          has_column_privilege('authenticated', 'public.contact_submissions', 'status', 'update'),  -- true
--          has_table_privilege('service_role', 'public.contact_submissions', 'insert');   -- true
--   Messages whose e-mail failed:
--   select id, created_at, subject from public.contact_submissions
--    where emailed_at is null and status <> 'spam' order by created_at desc;
--
-- ════════════════════════════════════════════════════════════════════════════
-- UNDO (loses every stored message: export them first)
-- ════════════════════════════════════════════════════════════════════════════
--   DROP TABLE IF EXISTS public.contact_submissions;

CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  name        text        NOT NULL,
  email       text        NOT NULL,
  company     text,
  subject     text        NOT NULL,
  message     text        NOT NULL,
  source      text,
  ip_hash     text,
  user_agent  text,
  status      text        NOT NULL DEFAULT 'new',
  handled_at  timestamptz,
  handled_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  emailed_at  timestamptz,
  CONSTRAINT contact_submissions_name_len       CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT contact_submissions_email_len      CHECK (char_length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1),
  CONSTRAINT contact_submissions_company_len    CHECK (company IS NULL OR char_length(company) <= 160),
  CONSTRAINT contact_submissions_subject_len    CHECK (char_length(subject) BETWEEN 1 AND 40),
  CONSTRAINT contact_submissions_message_len    CHECK (char_length(message) BETWEEN 10 AND 5000),
  CONSTRAINT contact_submissions_source_len     CHECK (source IS NULL OR char_length(source) <= 200),
  CONSTRAINT contact_submissions_ip_hash_len    CHECK (ip_hash IS NULL OR char_length(ip_hash) <= 128),
  CONSTRAINT contact_submissions_user_agent_len CHECK (user_agent IS NULL OR char_length(user_agent) <= 500),
  CONSTRAINT contact_submissions_status_check   CHECK (status IN ('new', 'handled', 'spam'))
);

COMMENT ON TABLE public.contact_submissions IS
  'Messages from the public contact form (/contact), written only by the edge function contact-submit (service role) and e-mailed to events@m3monaco.com. Readable and status-updatable by verified staff (is_moderator()) only. Hotfix 2026-10-07.';
COMMENT ON COLUMN public.contact_submissions.email IS
  'Visitor e-mail as typed, trimmed and lower-cased by contact-submit (also used for the per-address rate limit).';
COMMENT ON COLUMN public.contact_submissions.ip_hash IS
  'HMAC-SHA-256 (hex) of the caller IP under a server secret; never the IP. Used for the per-network rate limit.';
COMMENT ON COLUMN public.contact_submissions.emailed_at IS
  'Set by contact-submit when Resend accepted the e-mail to the inbox. NULL = stored but the e-mail failed (the visitor was shown an error and may have resent it): read it here.';

CREATE INDEX IF NOT EXISTS contact_submissions_created_at_idx
  ON public.contact_submissions (created_at DESC);

-- Rate-limit counts (last hour per hashed IP, per address).
CREATE INDEX IF NOT EXISTS contact_submissions_ip_hash_created_idx
  ON public.contact_submissions (ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_submissions_email_created_idx
  ON public.contact_submissions (email, created_at DESC);

ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- Verified staff read and triage. No INSERT / DELETE policy on purpose: only the
-- service role (which bypasses RLS) writes rows.
DROP POLICY IF EXISTS contact_submissions_staff_select ON public.contact_submissions;
CREATE POLICY contact_submissions_staff_select ON public.contact_submissions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_moderator()));

DROP POLICY IF EXISTS contact_submissions_staff_update ON public.contact_submissions;
CREATE POLICY contact_submissions_staff_update ON public.contact_submissions
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_moderator()))
  WITH CHECK ((SELECT public.is_moderator()));

-- New public tables get ALL for anon/authenticated through Supabase's default
-- privileges: take everything back, then grant only what staff screens need.
REVOKE ALL ON TABLE public.contact_submissions FROM PUBLIC;
REVOKE ALL ON TABLE public.contact_submissions FROM anon, authenticated;
GRANT SELECT ON TABLE public.contact_submissions TO authenticated;
GRANT UPDATE (status, handled_at, handled_by) ON TABLE public.contact_submissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_submissions TO service_role;
