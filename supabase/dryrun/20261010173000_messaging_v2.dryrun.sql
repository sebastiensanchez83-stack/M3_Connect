-- DRY RUN of supabase/migrations/20261010173000_messaging_v2.sql
--        and of its down script supabase/migrations/down/20261010173000_messaging_v2.down.sql
-- NOT A MIGRATION: never apply it. NOTHING IS KEPT.
--
-- How to run: the WHOLE file in ONE execute_sql call (one implicit transaction).
-- Do not add BEGIN/COMMIT and do not run it statement by statement. The last
-- statement ends with RAISE EXCEPTION 'DRYRUN ...': the migration, every test write
-- (test files are storage.objects ROWS only: nothing reaches the storage itself) and
-- the down script roll back; the error text IS the report ("n PASS, m FAIL" first,
-- then one line per check; INFO lines are not counted).
-- Tripwire: if the report says "before-snapshot missing", the statements did NOT run
-- in one transaction and the migration may have been committed: check
-- information_schema.columns for conversation_messages.attachments and
-- storage.buckets for 'message-attachments' at once, and run the down script if
-- they are there.
--
-- Layout
--   A. snapshot (policies of storage.objects and of the messaging tables,
--      partner_requests' columns and triggers, the realtime publication, the
--      result types of msg_thread / msg_conversations, the body rule);
--   B. the migration, verbatim;
--   C. temp helper (pg_temp.dr: formats one report line);
--   D. one DO block:
--        S01-S10  structure (column, rules, bucket, storage policies, publication,
--                 result types, privileges, nothing else changed, path rule, the
--                 names people see);
--        scenario F (files, "Seen", reports, realtime reads, quotas) in a
--                 sub-transaction: a conversation between two validated companies is
--                 made for the test (as postgres), then uploads, messages, reads and
--                 reports are done as the members themselves;
--        scenario Z  the down script, run whole (EXECUTE), then its result checked.
--      Callers are simulated with set local role authenticated / anon +
--      request.jwt.claims {sub, role}.
--
-- Callers: looked up AT RUN TIME (read-only, as postgres), so no account id is
-- written in this public repository:
--   S   a verified member (not admin/moderator) of a validated company OS, in no other company
--   C   another verified member of OS, if there is one (else those lines are skipped)
--   R   a verified member (not admin/moderator) of another validated company OM
--   X   a verified outsider (not admin/moderator), in neither OS nor OM
--   M   a verified admin who is in neither OS nor OM (M3 staff)
--
-- Expected: "36 PASS, 0 FAIL".
--
-- ─── 0. Locks ────────────────────────────────────────────────────────────────
-- The new policies take an ACCESS EXCLUSIVE lock on storage.objects, and the new
-- rules one on conversation_messages, until the whole run rolls back: every storage
-- request of the site (logos, photos, site media) waits meanwhile. The run is short
-- (no batch over all members: the digest check reads one person's unread items), but
-- run it at a quiet hour; it gives up rather than queue behind a busy table. If it
-- stops on "lock timeout", run it again.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ─── A. Snapshot ─────────────────────────────────────────────────────────────
create temp table _dr_before on commit drop as
  select 'policy ' || schemaname || '.' || tablename || '.' || policyname as k,
         permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as v
    from pg_policies
   where (schemaname = 'storage' and tablename = 'objects')
      or (schemaname = 'public' and tablename in ('partner_requests', 'conversation_messages', 'conversation_reads', 'conversation_reports'))
  union all
  select 'column ' || column_name, data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
    from information_schema.columns
   where table_schema = 'public' and table_name = 'partner_requests'
  union all
  select 'trigger ' || tgrelid::regclass::text || '.' || tgname, pg_get_triggerdef(oid)
    from pg_trigger
   where tgrelid in ('public.partner_requests'::regclass, 'public.conversation_messages'::regclass) and not tgisinternal
  union all
  select 'pub ' || schemaname || '.' || tablename, pubname::text
    from pg_publication_tables where pubname = 'supabase_realtime'
  union all
  select 'msgcount', count(*)::text from public.conversation_messages
  union all
  select 'bucket', count(*)::text from storage.buckets where id = 'message-attachments'
  union all
  select 'fnresult msg_thread', pg_get_function_result('public.msg_thread(uuid)'::regprocedure)
  union all
  select 'fnresult msg_conversations', pg_get_function_result('public.msg_conversations()'::regprocedure)
  union all
  select 'constraint body', pg_get_constraintdef(oid)
    from pg_constraint where conrelid = 'public.conversation_messages'::regclass and conname = 'conversation_messages_body_length';

-- ─── B. The migration, verbatim ──────────────────────────────────────────────
-- Messaging v2: files, "Seen" and live updates. Victor's choices of 10 Oct 2026
-- ("on peut faire mieux comme messagerie"; memory "messaging-decisions", v2).
-- Builds on 20261009190000_company_messaging.sql (applied 9 Oct).
--
-- ════════════════════════════════════════════════════════════════════════════
-- What it does
-- ════════════════════════════════════════════════════════════════════════════
--  1. conversation_messages.attachments (jsonb, null by default): the files of a
--     message, [{path, name, size, mime}], 1 to 5 of them. A message may now have
--     an empty text when it carries a file (conversation_messages_body_length is
--     replaced: at most 4000 characters, and text OR files). Every existing row
--     has a text, so it still passes.
--     The first message (partner_requests.message) stays text only.
--  2. A PRIVATE storage bucket "message-attachments": 10 MB per file, JPEG, PNG,
--     WebP and PDF only. A file lives at <partner_request_id>/<uuid>/<safe name>
--     (the safe name: letters, digits, dot, dash, underscore, at most 120, and it
--     ENDS with .pdf, .jpg, .jpeg, .png or .webp: never .exe, .html, "a.pdf.exe").
--     storage.objects policies for that bucket (authenticated only):
--       message_attachments_insert        upload, as oneself, into a conversation the
--                                         caller may write in now (msg_can_write for
--                                         their side: verified, accepted, on one of its
--                                         sides, company not suspended); path well
--                                         formed; at most 100 files an hour and 300 a
--                                         day per person (the 60-messages-an-hour rule
--                                         counts messages, not uploads);
--       message_attachments_select        the uploader reads their own files; the two
--                                         companies read a file only once a message
--                                         that is still shown carries it (a file chosen
--                                         and never sent, or the file of a message M3
--                                         removed, is not theirs to open); verified
--                                         moderators read the files of the messages an
--                                         OPEN report covers (sent up to the report's
--                                         time), nothing else;
--       message_attachments_delete_own    the uploader removes their own file as long
--                                         as no message carries it (the client tidies
--                                         up after a send that failed half way);
--       message_attachments_delete_staff  verified moderators remove a file an open
--                                         report covers.
--     No UPDATE policy (nobody replaces a file); a file that was sent stays, like the
--     messages. The bucket is not public: every read goes through a signed link the
--     client asks for (short expiry).
--  3. The BEFORE INSERT trigger of conversation_messages checks the files of a
--     member's message: each path must be in THIS conversation's folder, exist in
--     the bucket, have been uploaded by the author, be of an allowed type and size,
--     and its extension must be the type's (a ".png" stored as a PDF is refused);
--     size and type are copied from storage (never what the client says). The name
--     shown is cleaned (msg_attachment_display_name: no invisible direction or
--     zero-width characters, no control characters or slashes, 120 characters, and
--     it ends with the type's extension: "Invoice.pdf.exe" sent as a PDF shows and
--     downloads as "Invoice.pdf.exe.pdf"). At most 5 files, no file twice. Everything
--     else of the trigger is unchanged.
--     What stays possible: storage keeps the type the uploader declared, and the
--     bytes themselves are not inspected. A file declared as a PDF opens as a PDF
--     (or fails to), never as a program.
--  4. RPCs:
--       msg_thread(request)        + attachments (null for a removed message)
--       msg_conversations()        + last_attachment_count, last_attachment_name,
--                                    last_attachment_mime (the list shows "Photo" or
--                                    the file's name when the last message is a file)
--       msg_thread_seen(request)   NEW: per side of the conversation, the latest
--                                  time someone of that side (as it is now, msg_side)
--                                  read it, and who (first name, name). Only for a
--                                  caller who may read the conversation. Drives "Seen"
--                                  under my last message.
--       msg_report_excerpt         names the files of each message ("[files: a.pdf]"),
--                                  so M3 knows what a report is about.
--     msg_thread and msg_conversations keep their arguments and their columns in the
--     same order; the new columns come last (DROP + CREATE: a function's result type
--     cannot change in place; grants re-applied as before).
--  5. Realtime: public.conversation_messages and public.partner_requests join the
--     supabase_realtime publication (it had no table on 10 Oct 2026). Realtime sends
--     a change to a subscriber only when that subscriber may SELECT the row under
--     RLS: conversation_messages_select (msg_can_access: the two companies, as they
--     are now) and partner_requests' own SELECT policies (sender, receiver, their
--     companies, verified moderators). The client subscribes to INSERT (messages)
--     and INSERT/UPDATE (requests) only; with the default replica identity a DELETE
--     event would carry the row id alone.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Old client (main, live): unchanged
-- ════════════════════════════════════════════════════════════════════════════
--  It never reads conversation_messages, the msg_* functions or the new bucket. The
--  new storage policies name the new bucket only. Being in a publication changes
--  nothing for a table's readers and writers (no client of main subscribes). No row
--  is written; partner_requests is not altered.
--
-- Idempotent (IF NOT EXISTS, OR REPLACE, DROP ... IF EXISTS, ON CONFLICT).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Checks after applying (read-only)
-- ════════════════════════════════════════════════════════════════════════════
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
--     -> conversation_messages, partner_requests
--   select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'message-attachments';
--     -> f, 10485760, {image/jpeg,image/png,image/webp,application/pdf}
--   select policyname, cmd from pg_policies where schemaname = 'storage' and policyname like 'message_attachments%' order by 1;
--     -> message_attachments_delete_own DELETE, message_attachments_delete_staff DELETE,
--        message_attachments_insert INSERT, message_attachments_select SELECT
--   select pg_get_function_result('public.msg_thread(uuid)'::regprocedure);   -> ... is_deleted boolean, attachments jsonb)
--   select has_function_privilege('anon', 'public.msg_thread_seen(uuid)', 'execute');   -> false
--
-- UNDO: supabase/migrations/down/20261010173000_messaging_v2.down.sql
-- Dry run: supabase/dryrun/20261010173000_messaging_v2.dryrun.sql (this file, the
-- checks, then the down script, in one rolled-back transaction).

-- ─── 1. conversation_messages.attachments ──────────────────────────────────
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb;

COMMENT ON COLUMN public.conversation_messages.attachments IS
  'The files of the message: [{path, name, size, mime}], 1 to 5, in the private bucket message-attachments under <partner_request_id>/<uuid>/<safe name>. Checked and completed by conversation_messages_before_insert (size and mime from storage). Null: no file. 2026-10-10.';

ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_attachments_shape;
ALTER TABLE public.conversation_messages
  ADD CONSTRAINT conversation_messages_attachments_shape CHECK (
    attachments IS NULL
    OR CASE WHEN jsonb_typeof(attachments) = 'array' THEN jsonb_array_length(attachments) BETWEEN 1 AND 5 ELSE false END
  );

-- Text or files: a message with a file may have no text. At most 4000 characters.
ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_body_length;
ALTER TABLE public.conversation_messages
  ADD CONSTRAINT conversation_messages_body_length CHECK (
    char_length(body) <= 4000 AND (btrim(body) <> '' OR attachments IS NOT NULL)
  );

-- ─── 2. Helpers for the files ──────────────────────────────────────────────

-- The conversation a file path belongs to, or null when the path is not
-- <request uuid>/<uuid>/<safe name>.<pdf|jpg|jpeg|png|webp>. Pure.
CREATE OR REPLACE FUNCTION public.msg_attachment_request(p_name text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
           when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,114}\.(pdf|jpg|jpeg|png|webp)$'
             then split_part(p_name, '/', 1)::uuid
         end;
$function$;

-- The file types a message may carry (the bucket allows the same).
CREATE OR REPLACE FUNCTION public.msg_attachment_mime_ok(p_mime text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(p_mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'), false);
$function$;

-- A name (or path) ends with the extension of this type: .pdf for a PDF, .jpg or
-- .jpeg for a JPEG, .png, .webp. Pure.
CREATE OR REPLACE FUNCTION public.msg_attachment_ext_matches(p_name text, p_mime text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(case lower(p_mime)
           when 'application/pdf' then lower(p_name) ~ '\.pdf$'
           when 'image/jpeg' then lower(p_name) ~ '\.jpe?g$'
           when 'image/png' then lower(p_name) ~ '\.png$'
           when 'image/webp' then lower(p_name) ~ '\.webp$'
         end, false);
$function$;

-- The name people see (and the one a download is saved under): invisible format
-- characters removed (right-to-left overrides that would show "fdp.exe" as
-- "exe.pdf", zero-width spaces), control characters and slashes made spaces, 120
-- characters at most, the stored name when nothing is left, and the extension of the
-- file's type added when the name does not end with it. Pure. (The characters are
-- built with chr(): no backslash escape to get mangled on the way.)
CREATE OR REPLACE FUNCTION public.msg_attachment_display_name(p_name text, p_path text, p_mime text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with a as (
    select left(btrim(regexp_replace(
             regexp_replace(coalesce(p_name, ''),
               '[' || chr(173) || chr(1564) || chr(6158)
                   || chr(8203) || '-' || chr(8207)      -- zero-width space .. right-to-left mark
                   || chr(8232) || '-' || chr(8238)      -- line separator .. right-to-left override
                   || chr(8288) || '-' || chr(8303)      -- word joiner .. isolates
                   || chr(65279) || chr(65529) || '-' || chr(65531) || ']+', '', 'g'),
             '[[:cntrl:]/\\]+', ' ', 'g')), 120) as n
  ),
  b as (
    select case when a.n = '' then split_part(coalesce(p_path, ''), '/', 3) else a.n end as n from a
  )
  select case
           when public.msg_attachment_ext_matches(b.n, p_mime) then b.n
           else rtrim(left(b.n, 114), '. ') || '.'
                || case lower(coalesce(p_mime, ''))
                     when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg'
                     when 'image/png' then 'png' when 'image/webp' then 'webp' else 'file'
                   end
         end
    from b;
$function$;

-- The signed-in account may upload this file: a well-formed path in a conversation
-- it may write in now, for its own side; fewer than 100 files in the last hour and
-- 300 in the last day (the uploads it made into this bucket).
CREATE OR REPLACE FUNCTION public.msg_attachment_can_upload(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select public.msg_can_write(x.r, public.msg_my_side_org(x.r))
       and (select count(*) filter (where o.created_at > now() - interval '1 hour') < 100 and count(*) < 300
              from storage.objects o
             where o.bucket_id = 'message-attachments'
               and coalesce(o.owner_id, o.owner::text) = auth.uid()::text
               and o.created_at > now() - interval '24 hours')
      from (select public.msg_attachment_request(p_name) as r) x
     where x.r is not null), false);
$function$;

-- A verified moderator may open (and remove) this file: an OPEN report covers it, i.e.
-- a message of the reported conversation sent up to the report's time carries it
-- (what M3 sees in the report's excerpt). Nothing before a report, nothing after it
-- is closed, never a file that was not sent.
CREATE OR REPLACE FUNCTION public.msg_attachment_staff_access(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select public.is_moderator()
       and exists (select 1
                     from public.conversation_reports c
                     join public.conversation_messages m on m.partner_request_id = c.partner_request_id
                    where c.partner_request_id = x.r
                      and c.status = 'open'
                      and m.created_at <= c.created_at
                      and m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name)))
      from (select public.msg_attachment_request(p_name) as r) x
     where x.r is not null), false);
$function$;

-- The signed-in account may open this file as one of the two companies: it may read
-- the conversation (msg_can_access), and a message that is still shown carries the
-- file. Or M3 staff, as above. (The uploader's own files: the policy itself.)
CREATE OR REPLACE FUNCTION public.msg_attachment_can_read(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select (public.msg_can_access(x.r)
            and exists (select 1 from public.conversation_messages m
                         where m.partner_request_id = x.r
                           and m.deleted_at is null
                           and m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))))
        or public.msg_attachment_staff_access(p_name)
      from (select public.msg_attachment_request(p_name) as r) x
     where x.r is not null), false);
$function$;

-- No message carries this file (removed ones included): its uploader may delete it.
CREATE OR REPLACE FUNCTION public.msg_attachment_unsent(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select not exists (select 1 from public.conversation_messages m
                        where m.partner_request_id = x.r
                          and m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name)))
      from (select public.msg_attachment_request(p_name) as r) x
     where x.r is not null), false);
$function$;

-- ─── 3. The bucket ─────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('message-attachments', 'message-attachments', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 4. storage.objects policies (this bucket only) ────────────────────────
-- The storage service writes owner_id (and owner) from the caller's token. The
-- uploader's own files stay readable to them: the service reads the row back when it
-- uploads (INSERT ... RETURNING) and when it removes one.
DROP POLICY IF EXISTS message_attachments_insert ON storage.objects;
CREATE POLICY message_attachments_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'message-attachments'
              AND coalesce(owner_id, owner::text) = (select auth.uid())::text
              AND public.msg_attachment_can_upload(name));

DROP POLICY IF EXISTS message_attachments_select ON storage.objects;
CREATE POLICY message_attachments_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'message-attachments'
         AND (coalesce(owner_id, owner::text) = (select auth.uid())::text
              OR public.msg_attachment_can_read(name)));

DROP POLICY IF EXISTS message_attachments_delete_own ON storage.objects;
CREATE POLICY message_attachments_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'message-attachments'
         AND coalesce(owner_id, owner::text) = (select auth.uid())::text
         AND public.msg_attachment_unsent(name));

DROP POLICY IF EXISTS message_attachments_delete_staff ON storage.objects;
CREATE POLICY message_attachments_delete_staff ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'message-attachments' AND public.msg_attachment_staff_access(name));

-- ─── 5. The message trigger: files checked ─────────────────────────────────
-- As in 20261009190000 (author, company, time, trimmed text, 60 an hour), plus the
-- files of a member's message (see the header). The service role (no auth.uid())
-- is trusted, as before.
CREATE OR REPLACE FUNCTION public.conversation_messages_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_recent integer;
  v_item jsonb;
  v_path text;
  v_name text;
  v_meta jsonb;
  v_mime text;
  v_size bigint;
  v_clean jsonb := '[]'::jsonb;
begin
  if v_uid is not null then
    new.author_user_id := v_uid;
    new.author_org_id := public.msg_my_side_org(new.partner_request_id);
    new.created_at := now();
    new.deleted_at := null;
    new.body := btrim(coalesce(new.body, ''));
    select count(*) into v_recent
      from public.conversation_messages m
     where m.author_user_id = v_uid
       and m.created_at > now() - interval '1 hour';
    if v_recent >= 60 then
      raise exception 'You have sent many messages in the last hour. Please wait a little before sending more.'
        using errcode = 'P0001', hint = 'rate_limited';
    end if;

    -- Files: each one in this conversation's folder, uploaded by the author, of an
    -- allowed type and size. What is stored comes from storage, not the client.
    if new.attachments is not null then
      if jsonb_typeof(new.attachments) <> 'array' then
        raise exception 'The files of this message are not valid'
          using errcode = '22023', hint = 'attachment_invalid';
      elsif jsonb_array_length(new.attachments) = 0 then
        new.attachments := null;
      elsif jsonb_array_length(new.attachments) > 5 then
        raise exception 'You can send up to 5 files in one message'
          using errcode = '22023', hint = 'too_many_files';
      end if;
    end if;
    if new.attachments is not null then
      for v_item in select value from jsonb_array_elements(new.attachments) loop
        v_path := case when jsonb_typeof(v_item) = 'object' then v_item ->> 'path' end;
        if v_path is null or public.msg_attachment_request(v_path) is distinct from new.partner_request_id then
          raise exception 'This file does not belong to this conversation'
            using errcode = '22023', hint = 'attachment_invalid';
        end if;
        if v_clean @> jsonb_build_array(jsonb_build_object('path', v_path)) then
          raise exception 'The same file is attached twice'
            using errcode = '22023', hint = 'attachment_invalid';
        end if;
        select o.metadata into v_meta
          from storage.objects o
         where o.bucket_id = 'message-attachments'
           and o.name = v_path
           and coalesce(o.owner_id, o.owner::text) = v_uid::text;
        if not found then
          raise exception 'A file of this message could not be found. Please attach it again.'
            using errcode = '22023', hint = 'attachment_missing';
        end if;
        v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
        v_size := case when coalesce(v_meta ->> 'size', '') ~ '^[0-9]{1,15}$' then (v_meta ->> 'size')::bigint end;
        -- The type stored, and the path's extension must be that type's (a ".png"
        -- stored as a PDF is not a photo).
        if not public.msg_attachment_mime_ok(v_mime) or not public.msg_attachment_ext_matches(v_path, v_mime) then
          raise exception 'Only PDF, JPG, PNG or WebP files can be sent'
            using errcode = '22023', hint = 'attachment_type';
        end if;
        if v_size is null or v_size > 10485760 then
          raise exception 'A file can be up to 10 MB'
            using errcode = '22023', hint = 'attachment_size';
        end if;
        v_name := public.msg_attachment_display_name(case when jsonb_typeof(v_item -> 'name') = 'string' then v_item ->> 'name' end, v_path, v_mime);
        v_clean := v_clean || jsonb_build_array(jsonb_build_object('path', v_path, 'name', v_name, 'size', v_size, 'mime', v_mime));
      end loop;
      new.attachments := v_clean;
    end if;
  end if;
  return new;
end
$function$;

-- (trg_conversation_messages_before_insert already calls it.)

-- ─── 6. RPCs ───────────────────────────────────────────────────────────────

-- One conversation, oldest first (the last 300 messages), the first message
-- (partner_requests.message) included with is_first = true and the request's id.
-- Empty when the caller may not read it. attachments: null for a removed message.
DROP FUNCTION IF EXISTS public.msg_thread(uuid);
CREATE FUNCTION public.msg_thread(p_request uuid)
 RETURNS TABLE (
   id uuid,
   author_user_id uuid,
   author_name text,
   author_job_title text,
   author_avatar_url text,
   author_org_id uuid,
   author_org_name text,
   body text,
   created_at timestamptz,
   is_first boolean,
   from_my_side boolean,
   is_deleted boolean,
   attachments jsonb
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select auth.uid() as uid, public.msg_user_org_ids(auth.uid()) as orgs
     where public.msg_can_access(p_request)
  ),
  items as (
    select * from (
      select r.id, r.partner_user_id as author_user_id, r.partner_organization_id as author_org_id,
             btrim(r.message) as body, r.created_at, true as is_first, null::timestamptz as deleted_at,
             null::jsonb as attachments
        from public.partner_requests r
       where r.id = p_request
         and nullif(btrim(r.message), '') is not null
      union all
      select m.id, m.author_user_id, m.author_org_id, m.body, m.created_at, false, m.deleted_at, m.attachments
        from public.conversation_messages m
       where m.partner_request_id = p_request
    ) a
    order by a.created_at desc, a.is_first
    limit 300
  )
  select i.id,
         i.author_user_id,
         nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
         p.job_title,
         p.avatar_url,
         i.author_org_id,
         o.name,
         case when i.deleted_at is null then i.body end,
         i.created_at,
         i.is_first,
         coalesce(i.author_user_id = me.uid, false) or coalesce(i.author_org_id = any (me.orgs), false),
         i.deleted_at is not null,
         case when i.deleted_at is null then i.attachments end
    from items i
   cross join me
    left join public.profiles p on p.user_id = i.author_user_id
    left join public.organizations o on o.id = i.author_org_id
   order by i.created_at, i.is_first desc;
$function$;

-- The signed-in account's conversations, most recent activity first. As before,
-- plus what the last message carries: its number of files, the first one's name
-- and type (the preview is empty when it has no text).
DROP FUNCTION IF EXISTS public.msg_conversations();
CREATE FUNCTION public.msg_conversations()
 RETURNS TABLE (
   partner_request_id uuid,
   my_side text,
   my_org_id uuid,
   other_org_id uuid,
   other_org_name text,
   other_org_slug text,
   other_org_logo_url text,
   other_org_type text,
   other_person_name text,
   auto_connected boolean,
   started_at timestamptz,
   connected_at timestamptz,
   last_message_at timestamptz,
   last_message_preview text,
   last_author_name text,
   last_from_my_side boolean,
   unread_count integer,
   last_attachment_count integer,
   last_attachment_name text,
   last_attachment_mime text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select auth.uid() as uid, public.msg_user_org_ids(auth.uid()) as orgs
  ),
  threads as (
    select r.id, r.partner_user_id, r.marina_user_id, r.partner_organization_id, r.marina_organization_id,
           r.message, r.created_at, r.answered_at, r.auto_connected,
           case
             when (r.partner_organization_id is not null and r.partner_organization_id = any (me.orgs))
               or (r.partner_organization_id is null and r.partner_user_id = me.uid) then 'partner'
             else 'marina'
           end as side
      from public.partner_requests r
     cross join me
     where me.uid is not null
       and public.is_verified(NULL::public.persona_enum)
       and r.status = 'accepted'
       and ((r.partner_organization_id is not null and r.partner_organization_id = any (me.orgs))
         or (r.partner_organization_id is null and r.partner_user_id = me.uid)
         or (r.marina_organization_id is not null and r.marina_organization_id = any (me.orgs))
         or (r.marina_organization_id is null and r.marina_user_id = me.uid))
  ),
  unread as (
    select u.partner_request_id, count(*)::integer as n
      from me
     cross join lateral public.msg_unread_items(me.uid, null) u
     group by u.partner_request_id
  ),
  last_msg as (
    select distinct on (m.partner_request_id)
           m.partner_request_id, m.body, m.created_at, m.author_user_id, m.author_org_id, m.attachments
      from public.conversation_messages m
      join threads t on t.id = m.partner_request_id
     where m.deleted_at is null
     order by m.partner_request_id, m.created_at desc
  )
  select t.id,
         t.side,
         case when t.side = 'partner' then t.partner_organization_id else t.marina_organization_id end,
         o.id,
         o.name,
         o.slug,
         o.logo_url,
         o.organization_type,
         nullif(btrim(concat_ws(' ', op.first_name, op.last_name)), ''),
         t.auto_connected,
         t.created_at,
         coalesce(t.answered_at, t.created_at),
         coalesce(lm.created_at, t.created_at),
         left(regexp_replace(btrim(coalesce(lm.body, t.message, '')), '\s+', ' ', 'g'), 160),
         nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
         case
           when lm.partner_request_id is not null
             then coalesce(lm.author_user_id = me.uid, false) or coalesce(lm.author_org_id = any (me.orgs), false)
           else t.side = 'partner'
         end,
         coalesce(un.n, 0),
         case when jsonb_typeof(lm.attachments) = 'array' then jsonb_array_length(lm.attachments) else 0 end,
         lm.attachments -> 0 ->> 'name',
         lm.attachments -> 0 ->> 'mime'
    from threads t
   cross join me
    left join public.organizations o
           on o.id = case when t.side = 'partner' then t.marina_organization_id else t.partner_organization_id end
    left join public.profiles op
           on op.user_id = case when t.side = 'partner' then t.marina_user_id else t.partner_user_id end
    left join last_msg lm on lm.partner_request_id = t.id
    left join public.profiles ap on ap.user_id = coalesce(lm.author_user_id, t.partner_user_id)
    left join unread un on un.partner_request_id = t.id
   order by greatest(coalesce(lm.created_at, t.created_at), coalesce(t.answered_at, t.created_at)) desc;
$function$;

-- "Seen": per side of the conversation ('partner' wrote first, 'marina' received),
-- the latest time someone who is on that side NOW (msg_side) opened it, and who.
-- Empty when the caller may not read the conversation.
CREATE OR REPLACE FUNCTION public.msg_thread_seen(p_request uuid)
 RETURNS TABLE (
   side text,
   is_my_side boolean,
   last_read_at timestamptz,
   reader_first_name text,
   reader_name text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select public.msg_side(p_request, auth.uid()) as my_side
     where public.msg_can_access(p_request)
  ),
  readers as (
    select public.msg_side(rd.partner_request_id, rd.user_id) as side, rd.user_id, rd.last_read_at
      from public.conversation_reads rd
     cross join me
     where rd.partner_request_id = p_request
  ),
  latest as (
    select distinct on (r.side) r.side, r.user_id, r.last_read_at
      from readers r
     where r.side is not null
     order by r.side, r.last_read_at desc, r.user_id
  )
  select l.side,
         l.side = me.my_side,
         l.last_read_at,
         nullif(btrim(p.first_name), ''),
         nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    from latest l
   cross join me
    left join public.profiles p on p.user_id = l.user_id;
$function$;

-- What M3 receives with a report (as in 20261009190000), each message followed by
-- the names of its files.
CREATE OR REPLACE FUNCTION public.msg_report_excerpt(p_request uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select string_agg(
           format('%s UTC · %s (%s): %s',
                  to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
                  coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Unknown person'),
                  coalesce(o.name, 'no company'),
                  case
                    when x.deleted_at is not null then '[removed]'
                    else concat_ws(' ',
                           nullif(left(x.body, 600), ''),
                           case when jsonb_typeof(x.attachments) = 'array' then
                             '[files: ' || (select string_agg(coalesce(a ->> 'name', 'file'), ', ')
                                              from jsonb_array_elements(x.attachments) a) || ']'
                           end)
                  end),
           E'\n' order by x.created_at)
    from (
      select * from (
        select r.partner_user_id as author_user_id, r.partner_organization_id as author_org_id,
               btrim(r.message) as body, r.created_at, null::timestamptz as deleted_at, null::jsonb as attachments
          from public.partner_requests r
         where r.id = p_request and nullif(btrim(r.message), '') is not null
        union all
        select m.author_user_id, m.author_org_id, m.body, m.created_at, m.deleted_at, m.attachments
          from public.conversation_messages m
         where m.partner_request_id = p_request
           and exists (select 1 from public.partner_requests r2
                        where r2.id = p_request and r2.status = 'accepted')
      ) a
      order by a.created_at desc
      limit 30
    ) x
    left join public.profiles p on p.user_id = x.author_user_id
    left join public.organizations o on o.id = x.author_org_id;
$function$;

-- ─── 7. Function privileges ────────────────────────────────────────────────
-- Used by the storage policies (a policy runs with the caller's rights) and by the
-- client: signed-in members. Each one checks the caller itself.
REVOKE ALL ON FUNCTION public.msg_attachment_request(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_attachment_mime_ok(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_attachment_ext_matches(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_attachment_display_name(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_attachment_can_upload(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_attachment_staff_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_attachment_can_read(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_attachment_unsent(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_thread(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_conversations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_thread_seen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.msg_attachment_request(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_attachment_mime_ok(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_attachment_ext_matches(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_attachment_display_name(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_attachment_can_upload(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_attachment_staff_access(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_attachment_can_read(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_attachment_unsent(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_thread(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_conversations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_thread_seen(uuid) TO authenticated, service_role;
-- msg_report_excerpt keeps its privileges (service role only; CREATE OR REPLACE).

-- ─── 8. Realtime ───────────────────────────────────────────────────────────
-- Realtime delivers a row change only to subscribers whose RLS lets them SELECT it.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversation_messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'partner_requests') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_requests;
    END IF;
  ELSE
    RAISE NOTICE 'messaging_v2: publication supabase_realtime not found; live updates fall back to polling';
  END IF;
END
$do$;

-- ─── C. Report helper ────────────────────────────────────────────────────────
create function pg_temp.dr(p_id text, p_ok boolean, p_detail text)
 returns text language sql immutable as
$f$ select format(E'\n%s %s %s', case when p_ok then 'PASS' else 'FAIL' end, p_id, left(coalesce(p_detail, ''), 400)) $f$;

-- ─── D. Checks ───────────────────────────────────────────────────────────────
do $dryrun$
declare
  results text := '';
  n_pass integer := 0;
  n_fail integer := 0;
  v_ok boolean;
  v_err text; v_state text; v_hint text;
  v_s uuid; v_c uuid; v_os uuid; v_r uuid; v_om uuid; v_x uuid; v_m uuid;
  v_r_first text; v_s_first text;
  v_req uuid; v_pend uuid; v_msg1 uuid; v_msg2 uuid; v_msg3 uuid; v_msg4 uuid; v_rep uuid;
  v_pdf text; v_png text; v_html text; v_fake text; v_big text; v_left text; v_rfile text; v_late text;
  v_i integer; v_j integer; v_k integer; v_l integer; v_n integer;
  v_t text; v_t2 text; v_t3 text; v_b boolean; v_b2 boolean;
  v_ts timestamptz;
  v_json jsonb;
  v_rec record;
  c_labels constant text[] := array['big', 'fake', 'html', 'left', 'pdf', 'png', 'rfile'];
  c_first constant text := 'Dry run first message: hello from our team.';
  c_text constant text := 'Dry run reply with a photo of the pontoon.';
  c_down constant text := $down$
-- DOWN for supabase/migrations/20261010173000_messaging_v2.sql
--
-- Back to the messaging of 20261009190000_company_messaging.sql. Run it only with a
-- client that no longer sends files or reads "Seen" (the refonte before rf-msg2).
--
-- DATA: files already sent are NOT deleted. The bucket "message-attachments" stays
-- when it holds files (Supabase refuses direct deletes from storage tables: empty
-- it in the dashboard first if it must go); with no policy left, members can no
-- longer upload or open them. A message that had a file and no text gets the text
-- "[A file was sent here]" (the 9 Oct rule wants a text); the column attachments
-- is dropped with the list of files.
-- The two tables leave the realtime publication (they were not in it before).

-- Realtime
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversation_messages') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.conversation_messages;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'partner_requests') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.partner_requests;
  END IF;
END
$do$;

-- Storage policies, then their helpers
DROP POLICY IF EXISTS message_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS message_attachments_select ON storage.objects;
DROP POLICY IF EXISTS message_attachments_delete_own ON storage.objects;
DROP POLICY IF EXISTS message_attachments_delete_staff ON storage.objects;
DROP FUNCTION IF EXISTS public.msg_attachment_can_read(text);
DROP FUNCTION IF EXISTS public.msg_attachment_staff_access(text);
DROP FUNCTION IF EXISTS public.msg_attachment_staff_can_delete(text);
DROP FUNCTION IF EXISTS public.msg_attachment_unsent(text);
DROP FUNCTION IF EXISTS public.msg_attachment_can_upload(text);

-- The bucket: only when it is empty (see the header).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'message-attachments')
     AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments') THEN
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    DELETE FROM storage.buckets WHERE id = 'message-attachments';
    PERFORM set_config('storage.allow_delete_query', 'false', true);
  ELSE
    RAISE NOTICE 'messaging_v2 down: bucket message-attachments kept (it holds files, or is already gone)';
  END IF;
END
$do$;

-- "Seen"
DROP FUNCTION IF EXISTS public.msg_thread_seen(uuid);

-- The 9 Oct functions, verbatim from 20261009190000_company_messaging.sql
CREATE OR REPLACE FUNCTION public.conversation_messages_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_recent integer;
begin
  if v_uid is not null then
    new.author_user_id := v_uid;
    new.author_org_id := public.msg_my_side_org(new.partner_request_id);
    new.created_at := now();
    new.deleted_at := null;
    new.body := btrim(coalesce(new.body, ''));
    select count(*) into v_recent
      from public.conversation_messages m
     where m.author_user_id = v_uid
       and m.created_at > now() - interval '1 hour';
    if v_recent >= 60 then
      raise exception 'You have sent many messages in the last hour. Please wait a little before sending more.'
        using errcode = 'P0001', hint = 'rate_limited';
    end if;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.msg_report_excerpt(p_request uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select string_agg(
           format('%s UTC · %s (%s): %s',
                  to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
                  coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Unknown person'),
                  coalesce(o.name, 'no company'),
                  case when x.deleted_at is not null then '[removed]' else left(x.body, 600) end),
           E'\n' order by x.created_at)
    from (
      select * from (
        select r.partner_user_id as author_user_id, r.partner_organization_id as author_org_id,
               btrim(r.message) as body, r.created_at, null::timestamptz as deleted_at
          from public.partner_requests r
         where r.id = p_request and nullif(btrim(r.message), '') is not null
        union all
        select m.author_user_id, m.author_org_id, m.body, m.created_at, m.deleted_at
          from public.conversation_messages m
         where m.partner_request_id = p_request
           and exists (select 1 from public.partner_requests r2
                        where r2.id = p_request and r2.status = 'accepted')
      ) a
      order by a.created_at desc
      limit 30
    ) x
    left join public.profiles p on p.user_id = x.author_user_id
    left join public.organizations o on o.id = x.author_org_id;
$function$;

DROP FUNCTION IF EXISTS public.msg_conversations();
CREATE FUNCTION public.msg_conversations()
 RETURNS TABLE (
   partner_request_id uuid,
   my_side text,
   my_org_id uuid,
   other_org_id uuid,
   other_org_name text,
   other_org_slug text,
   other_org_logo_url text,
   other_org_type text,
   other_person_name text,
   auto_connected boolean,
   started_at timestamptz,
   connected_at timestamptz,
   last_message_at timestamptz,
   last_message_preview text,
   last_author_name text,
   last_from_my_side boolean,
   unread_count integer
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select auth.uid() as uid, public.msg_user_org_ids(auth.uid()) as orgs
  ),
  threads as (
    select r.id, r.partner_user_id, r.marina_user_id, r.partner_organization_id, r.marina_organization_id,
           r.message, r.created_at, r.answered_at, r.auto_connected,
           case
             when (r.partner_organization_id is not null and r.partner_organization_id = any (me.orgs))
               or (r.partner_organization_id is null and r.partner_user_id = me.uid) then 'partner'
             else 'marina'
           end as side
      from public.partner_requests r
     cross join me
     where me.uid is not null
       and public.is_verified(NULL::public.persona_enum)
       and r.status = 'accepted'
       and ((r.partner_organization_id is not null and r.partner_organization_id = any (me.orgs))
         or (r.partner_organization_id is null and r.partner_user_id = me.uid)
         or (r.marina_organization_id is not null and r.marina_organization_id = any (me.orgs))
         or (r.marina_organization_id is null and r.marina_user_id = me.uid))
  ),
  unread as (
    select u.partner_request_id, count(*)::integer as n
      from me
     cross join lateral public.msg_unread_items(me.uid, null) u
     group by u.partner_request_id
  ),
  last_msg as (
    select distinct on (m.partner_request_id)
           m.partner_request_id, m.body, m.created_at, m.author_user_id, m.author_org_id
      from public.conversation_messages m
      join threads t on t.id = m.partner_request_id
     where m.deleted_at is null
     order by m.partner_request_id, m.created_at desc
  )
  select t.id,
         t.side,
         case when t.side = 'partner' then t.partner_organization_id else t.marina_organization_id end,
         o.id,
         o.name,
         o.slug,
         o.logo_url,
         o.organization_type,
         nullif(btrim(concat_ws(' ', op.first_name, op.last_name)), ''),
         t.auto_connected,
         t.created_at,
         coalesce(t.answered_at, t.created_at),
         coalesce(lm.created_at, t.created_at),
         left(regexp_replace(btrim(coalesce(lm.body, t.message, '')), '\s+', ' ', 'g'), 160),
         nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
         case
           when lm.partner_request_id is not null
             then coalesce(lm.author_user_id = me.uid, false) or coalesce(lm.author_org_id = any (me.orgs), false)
           else t.side = 'partner'
         end,
         coalesce(un.n, 0)
    from threads t
   cross join me
    left join public.organizations o
           on o.id = case when t.side = 'partner' then t.marina_organization_id else t.partner_organization_id end
    left join public.profiles op
           on op.user_id = case when t.side = 'partner' then t.marina_user_id else t.partner_user_id end
    left join last_msg lm on lm.partner_request_id = t.id
    left join public.profiles ap on ap.user_id = coalesce(lm.author_user_id, t.partner_user_id)
    left join unread un on un.partner_request_id = t.id
   order by greatest(coalesce(lm.created_at, t.created_at), coalesce(t.answered_at, t.created_at)) desc;
$function$;

DROP FUNCTION IF EXISTS public.msg_thread(uuid);
CREATE FUNCTION public.msg_thread(p_request uuid)
 RETURNS TABLE (
   id uuid,
   author_user_id uuid,
   author_name text,
   author_job_title text,
   author_avatar_url text,
   author_org_id uuid,
   author_org_name text,
   body text,
   created_at timestamptz,
   is_first boolean,
   from_my_side boolean,
   is_deleted boolean
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select auth.uid() as uid, public.msg_user_org_ids(auth.uid()) as orgs
     where public.msg_can_access(p_request)
  ),
  items as (
    select * from (
      select r.id, r.partner_user_id as author_user_id, r.partner_organization_id as author_org_id,
             btrim(r.message) as body, r.created_at, true as is_first, null::timestamptz as deleted_at
        from public.partner_requests r
       where r.id = p_request
         and nullif(btrim(r.message), '') is not null
      union all
      select m.id, m.author_user_id, m.author_org_id, m.body, m.created_at, false, m.deleted_at
        from public.conversation_messages m
       where m.partner_request_id = p_request
    ) a
    order by a.created_at desc, a.is_first
    limit 300
  )
  select i.id,
         i.author_user_id,
         nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
         p.job_title,
         p.avatar_url,
         i.author_org_id,
         o.name,
         case when i.deleted_at is null then i.body end,
         i.created_at,
         i.is_first,
         coalesce(i.author_user_id = me.uid, false) or coalesce(i.author_org_id = any (me.orgs), false),
         i.deleted_at is not null
    from items i
   cross join me
    left join public.profiles p on p.user_id = i.author_user_id
    left join public.organizations o on o.id = i.author_org_id
   order by i.created_at, i.is_first desc;
$function$;

REVOKE ALL ON FUNCTION public.msg_conversations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.msg_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.msg_conversations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.msg_thread(uuid) TO authenticated, service_role;

-- File-only messages get a text, then the 9 Oct text rule and no column.
UPDATE public.conversation_messages
   SET body = '[A file was sent here]'
 WHERE btrim(body) = '';
ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_body_length;
ALTER TABLE public.conversation_messages
  ADD CONSTRAINT conversation_messages_body_length CHECK (char_length(body) BETWEEN 1 AND 4000 AND btrim(body) <> '');
ALTER TABLE public.conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_attachments_shape;
ALTER TABLE public.conversation_messages DROP COLUMN IF EXISTS attachments;

DROP FUNCTION IF EXISTS public.msg_attachment_display_name(text, text, text);
DROP FUNCTION IF EXISTS public.msg_attachment_ext_matches(text, text);
DROP FUNCTION IF EXISTS public.msg_attachment_mime_ok(text);
DROP FUNCTION IF EXISTS public.msg_attachment_request(text);
$down$;
begin
  if to_regclass('pg_temp._dr_before') is null then
    raise exception 'DRYRUN FAIL before-snapshot missing: the statements did not run in one transaction; check whether the migration was committed';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  /* ═══════════════════════ structure ═══════════════════════ */

  -- S01: the column and the two rules on conversation_messages.
  select count(*) into v_i from information_schema.columns
   where table_schema = 'public' and table_name = 'conversation_messages' and column_name = 'attachments'
     and data_type = 'jsonb' and is_nullable = 'YES' and column_default is null;
  select pg_get_constraintdef(oid) into v_t from pg_constraint
   where conrelid = 'public.conversation_messages'::regclass and conname = 'conversation_messages_body_length';
  select pg_get_constraintdef(oid) into v_t2 from pg_constraint
   where conrelid = 'public.conversation_messages'::regclass and conname = 'conversation_messages_attachments_shape';
  v_ok := coalesce(v_i = 1 and v_t like '%char_length(body) <= 4000%' and v_t like '%attachments IS NOT NULL%'
                   and v_t2 like '%jsonb_array_length(attachments)%', false);
  results := results || pg_temp.dr('S01', v_ok, format('attachments jsonb nullable (%s); body rule: %s; shape rule present: %s', v_i, v_t, v_t2 is not null));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S02: both rules validated against the existing rows.
  select count(*) filter (where convalidated), count(*) into v_i, v_j from pg_constraint
   where conrelid = 'public.conversation_messages'::regclass
     and conname in ('conversation_messages_body_length', 'conversation_messages_attachments_shape');
  select v into v_t from _dr_before where k = 'msgcount';
  select count(*)::text into v_t2 from public.conversation_messages;
  v_ok := v_i = 2 and v_j = 2 and v_t = v_t2;
  results := results || pg_temp.dr('S02', v_ok, format('rules valid on every existing message (%s of %s); messages before %s, now %s', v_i, v_j, v_t, v_t2));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S03: the bucket.
  select v into v_t2 from _dr_before where k = 'bucket';
  select format('%s|%s|%s', b.public, b.file_size_limit, array_to_string(b.allowed_mime_types, ',')) into v_t
    from storage.buckets b where b.id = 'message-attachments';
  v_ok := v_t = 'f|10485760|image/jpeg,image/png,image/webp,application/pdf' and v_t2 = '0';
  results := results || pg_temp.dr('S03', v_ok, format('bucket message-attachments (existed before: %s): %s', v_t2, coalesce(v_t, 'missing')));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S04: storage and messaging policies: exactly the four new ones added, none changed or removed.
  select count(*) filter (where b.k is null), count(*) filter (where a.k is null), count(*) filter (where a.v <> b.v),
         string_agg(coalesce(a.k, b.k), ', ' order by coalesce(a.k, b.k)) filter (where a.k is null or b.k is null or a.v <> b.v)
    into v_i, v_j, v_k, v_t
    from (select 'policy ' || schemaname || '.' || tablename || '.' || policyname as k,
                 permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as v
            from pg_policies
           where (schemaname = 'storage' and tablename = 'objects')
              or (schemaname = 'public' and tablename in ('partner_requests', 'conversation_messages', 'conversation_reads', 'conversation_reports'))) a
    full join (select k, v from _dr_before where k like 'policy %') b on a.k = b.k;
  select string_agg(policyname || ':' || cmd || ':' || permissive || ':' || roles::text, ',' order by policyname) into v_t2
    from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'message\_attachments%';
  v_ok := v_i = 4 and v_j = 0 and v_k = 0
          and v_t = 'policy storage.objects.message_attachments_delete_own, policy storage.objects.message_attachments_delete_staff, policy storage.objects.message_attachments_insert, policy storage.objects.message_attachments_select'
          and v_t2 = 'message_attachments_delete_own:DELETE:PERMISSIVE:{authenticated},message_attachments_delete_staff:DELETE:PERMISSIVE:{authenticated},message_attachments_insert:INSERT:PERMISSIVE:{authenticated},message_attachments_select:SELECT:PERMISSIVE:{authenticated}';
  results := results || pg_temp.dr('S04', v_ok, format('policies: %s added, %s removed, %s changed (%s); new: %s', v_i, v_j, v_k, v_t, v_t2));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S05: the realtime publication: the two tables added, nothing else touched.
  select count(*) into v_i from pg_publication_tables where pubname = 'supabase_realtime';
  select count(*), count(*) filter (where k in ('pub public.conversation_messages', 'pub public.partner_requests')) into v_j, v_k
    from _dr_before where k like 'pub %';
  select string_agg(tablename::text, ',' order by tablename) into v_t from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('conversation_messages', 'partner_requests');
  v_ok := v_t = 'conversation_messages,partner_requests' and v_i = v_j + 2 - v_k;
  results := results || pg_temp.dr('S05', v_ok, format('supabase_realtime: %s; tables before %s, now %s', coalesce(v_t, 'none'), v_j, v_i));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S06: result types: the old columns in the same order, the new ones last.
  select v into v_t from _dr_before where k = 'fnresult msg_thread';
  select v into v_t2 from _dr_before where k = 'fnresult msg_conversations';
  v_ok := pg_get_function_result('public.msg_thread(uuid)'::regprocedure) = left(v_t, length(v_t) - 1) || ', attachments jsonb)'
      and pg_get_function_result('public.msg_conversations()'::regprocedure)
            = left(v_t2, length(v_t2) - 1) || ', last_attachment_count integer, last_attachment_name text, last_attachment_mime text)'
      and pg_get_function_result('public.msg_thread_seen(uuid)'::regprocedure)
            = 'TABLE(side text, is_my_side boolean, last_read_at timestamp with time zone, reader_first_name text, reader_name text)';
  results := results || pg_temp.dr('S06', v_ok, 'msg_thread + attachments, msg_conversations + 3 file columns, msg_thread_seen: '
    || pg_get_function_result('public.msg_thread(uuid)'::regprocedure));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S07: privileges.
  v_ok := not has_function_privilege('anon', 'public.msg_thread_seen(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.msg_thread(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.msg_conversations()', 'execute')
      and not has_function_privilege('anon', 'public.msg_attachment_can_read(text)', 'execute')
      and not has_function_privilege('anon', 'public.msg_attachment_can_upload(text)', 'execute')
      and not has_function_privilege('anon', 'public.msg_attachment_staff_access(text)', 'execute')
      and not has_function_privilege('anon', 'public.msg_attachment_unsent(text)', 'execute')
      and not has_function_privilege('anon', 'public.msg_attachment_display_name(text, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.msg_attachment_ext_matches(text, text)', 'execute')
      and has_function_privilege('authenticated', 'public.msg_thread_seen(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.msg_thread(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.msg_conversations()', 'execute')
      and has_function_privilege('authenticated', 'public.msg_attachment_can_read(text)', 'execute')
      and has_function_privilege('authenticated', 'public.msg_attachment_can_upload(text)', 'execute')
      and has_function_privilege('authenticated', 'public.msg_attachment_staff_access(text)', 'execute')
      and has_function_privilege('authenticated', 'public.msg_attachment_unsent(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.msg_report_excerpt(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.msg_thread_seen(uuid)', 'execute');
  results := results || pg_temp.dr('S07', v_ok, 'anon runs none of the new or replaced functions; members run them; msg_report_excerpt stays service-only');
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S08: partner_requests columns and the triggers of both tables unchanged (the old client's table).
  select count(*) filter (where b.k is null), count(*) filter (where a.k is null), count(*) filter (where a.v <> b.v)
    into v_i, v_j, v_k
    from (select 'column ' || column_name as k, data_type || '|' || is_nullable || '|' || coalesce(column_default, '') as v
            from information_schema.columns where table_schema = 'public' and table_name = 'partner_requests'
          union all
          select 'trigger ' || tgrelid::regclass::text || '.' || tgname, pg_get_triggerdef(oid)
            from pg_trigger
           where tgrelid in ('public.partner_requests'::regclass, 'public.conversation_messages'::regclass) and not tgisinternal) a
    full join (select k, v from _dr_before where k like 'column %' or k like 'trigger %') b on a.k = b.k;
  v_ok := v_i = 0 and v_j = 0 and v_k = 0;
  results := results || pg_temp.dr('S08', v_ok, format('partner_requests columns and the triggers: %s added, %s removed, %s changed', v_i, v_j, v_k));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S09: the path rule: <request>/<uuid>/<safe name> ending with .pdf .jpg .jpeg .png .webp only.
  v_ok := public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/0b9a3c1d-aaaa-4bbb-8ccc-ddddeeeeffff/Brochure_2026-v2.pdf') = '7d4f2a8e-1111-4222-8333-444455556666'::uuid
      and public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/0b9a3c1d-aaaa-4bbb-8ccc-ddddeeeeffff/IMG_0042.jpeg') = '7d4f2a8e-1111-4222-8333-444455556666'::uuid
      and public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/Brochure.pdf') is null
      and public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/0b9a3c1d-aaaa-4bbb-8ccc-ddddeeeeffff/../x.pdf') is null
      and public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/0b9a3c1d-aaaa-4bbb-8ccc-ddddeeeeffff/a/b.pdf') is null
      and public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/0b9a3c1d-aaaa-4bbb-8ccc-ddddeeeeffff/my file.pdf') is null
      and public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/0b9a3c1d-aaaa-4bbb-8ccc-ddddeeeeffff/setup.exe') is null
      and public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/0b9a3c1d-aaaa-4bbb-8ccc-ddddeeeeffff/Invoice.pdf.exe') is null
      and public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/0b9a3c1d-aaaa-4bbb-8ccc-ddddeeeeffff/page.html') is null
      and public.msg_attachment_request('7d4f2a8e-1111-4222-8333-444455556666/0b9a3c1d-aaaa-4bbb-8ccc-ddddeeeeffff/noextension') is null
      and public.msg_attachment_request(null) is null
      and public.msg_attachment_mime_ok('application/pdf') and not public.msg_attachment_mime_ok('text/html')
      and not public.msg_attachment_mime_ok(null);
  results := results || pg_temp.dr('S09', v_ok, 'paths: <request>/<uuid>/<safe name>.pdf|jpg|jpeg|png|webp only (no "..", sub-folder, space, .exe, "a.pdf.exe", .html); types: JPEG, PNG, WebP, PDF');
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  -- S10: the names people see: invisible characters out, the type's extension last.
  v_t := concat_ws(' | ',
    public.msg_attachment_display_name('Invoice.pdf.exe', null, 'application/pdf'),
    public.msg_attachment_display_name('Invoice' || chr(8238) || 'fdp.exe', null, 'application/pdf'),
    public.msg_attachment_display_name('Photo.JPG', null, 'image/jpeg'),
    public.msg_attachment_display_name('  ' || chr(8203) || ' ', 'r/u/scan-2.pdf', 'application/pdf'),
    public.msg_attachment_display_name('a/b' || chr(10) || 'c.png', null, 'image/png'),
    public.msg_attachment_display_name('report.', null, 'application/pdf'),
    public.msg_attachment_display_name(repeat('x', 200) || '.pdf', null, 'application/pdf'));
  v_ok := v_t = 'Invoice.pdf.exe.pdf | Invoicefdp.exe.pdf | Photo.JPG | scan-2.pdf | a b c.png | report.pdf | ' || repeat('x', 114) || '.pdf'
      and public.msg_attachment_ext_matches('x.jpeg', 'image/jpeg') and public.msg_attachment_ext_matches('X.PDF', 'application/pdf')
      and not public.msg_attachment_ext_matches('x.png', 'application/pdf') and not public.msg_attachment_ext_matches(null, 'application/pdf')
      and not public.msg_attachment_ext_matches('x.pdf', 'text/html');
  results := results || pg_temp.dr('S10', v_ok, 'display names: ' || left(coalesce(v_t, 'null'), 160));
  n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

  /* ═══════════════════════ callers (read-only) ═══════════════════════ */

  select m.user_id, m.organization_id into v_s, v_os
    from public.organization_members m
    join public.profiles p on p.user_id = m.user_id and p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator')
    join public.organizations o on o.id = m.organization_id and o.access_status = 'verified'
   where (select count(*) from public.organization_members z where z.user_id = m.user_id) = 1
     and not exists (select 1 from public.organizations z where z.owner_user_id = m.user_id and z.id <> m.organization_id)
   order by (select count(*) from public.organization_members x
               join public.profiles px on px.user_id = x.user_id and px.access_status = 'verified'
              where x.organization_id = m.organization_id) desc, m.organization_id, m.joined_at, m.user_id
   limit 1;

  select m.user_id into v_c
    from public.organization_members m
    join public.profiles p on p.user_id = m.user_id and p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator')
   where m.organization_id = v_os and m.user_id <> v_s
     and (select count(*) from public.organization_members z where z.user_id = m.user_id) = 1
     and not exists (select 1 from public.organizations z where z.owner_user_id = m.user_id and z.id <> m.organization_id)
   order by m.joined_at, m.user_id limit 1;

  select m.user_id, m.organization_id into v_r, v_om
    from public.organization_members m
    join public.profiles p on p.user_id = m.user_id and p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator')
    join public.organizations o on o.id = m.organization_id and o.access_status = 'verified'
   where m.organization_id <> v_os
     and (select count(*) from public.organization_members z where z.user_id = m.user_id) = 1
     and not exists (select 1 from public.organizations z where z.owner_user_id = m.user_id and z.id <> m.organization_id)
     and m.joined_at < now() - interval '1 day'
   order by m.organization_id, m.joined_at, m.user_id
   limit 1;

  select p.user_id into v_x
    from public.profiles p
   where p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator')
     and not exists (select 1 from public.organization_members z where z.user_id = p.user_id and z.organization_id in (v_os, v_om))
     and not exists (select 1 from public.organizations z where z.owner_user_id = p.user_id and z.id in (v_os, v_om))
   order by p.user_id limit 1;

  select p.user_id into v_m
    from public.profiles p
   where p.access_status = 'verified' and p.persona::text = 'admin'
     and not exists (select 1 from public.organization_members z where z.user_id = p.user_id and z.organization_id in (v_os, v_om))
     and not exists (select 1 from public.organizations z where z.owner_user_id = p.user_id and z.id in (v_os, v_om))
   order by p.user_id limit 1;

  select nullif(btrim(first_name), '') into v_r_first from public.profiles where user_id = v_r;
  select nullif(btrim(first_name), '') into v_s_first from public.profiles where user_id = v_s;

  if v_s is null or v_os is null or v_r is null or v_om is null or v_x is null or v_m is null then
    raise exception 'DRYRUN %', format('LOOKUP FAILED: S=%s OS=%s R=%s OM=%s X=%s M=%s', v_s is not null, v_os is not null,
      v_r is not null, v_om is not null, v_x is not null, v_m is not null) || results;
  end if;
  results := results || format(E'\nINFO callers found: colleague C %s', v_c is not null);

  /* ═══════════════════════ F. files, "Seen", reports, realtime reads ═══════════════════════ */
  begin
    -- The test conversation (accepted) and a pending request between OS and OM, made as
    -- postgres (the old way: no origin, so none of the first-message rules apply).
    insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, status)
    values (v_s, v_r, v_os, v_om, c_first, 'accepted') returning id into v_req;
    insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, status)
    values (v_s, v_r, v_os, v_om, c_first, 'pending') returning id into v_pend;
    update public.partner_requests set created_at = now() - interval '10 minutes' where id = v_req;
    v_pdf   := v_req::text || '/' || gen_random_uuid()::text || '/Brochure-2026.pdf';
    v_png   := v_req::text || '/' || gen_random_uuid()::text || '/harbour.png';
    v_html  := v_req::text || '/' || gen_random_uuid()::text || '/page.pdf';    -- an HTML page under a .pdf name
    v_fake  := v_req::text || '/' || gen_random_uuid()::text || '/photo.png';   -- a PDF under a .png name
    v_big   := v_req::text || '/' || gen_random_uuid()::text || '/plans.pdf';   -- 20 MB
    v_left  := v_req::text || '/' || gen_random_uuid()::text || '/draft.pdf';   -- chosen, never sent
    v_rfile := v_req::text || '/' || gen_random_uuid()::text || '/offer.pdf';   -- R's, never sent

    -- F01: S uploads 6 files into the conversation (storage rows only), 3 of them odd
    -- ones the storage service would refuse (declared HTML, 20 MB) or that lie about
    -- their type: the database policy checks who, where and how many; type and size
    -- are the bucket's and the message trigger's job.
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
        ('message-attachments', v_pdf, v_s, v_s::text, jsonb_build_object('size', 52000, 'mimetype', 'application/pdf')),
        ('message-attachments', v_png, v_s, v_s::text, jsonb_build_object('size', 230000, 'mimetype', 'image/png')),
        ('message-attachments', v_html, v_s, v_s::text, jsonb_build_object('size', 1000, 'mimetype', 'text/html')),
        ('message-attachments', v_fake, v_s, v_s::text, jsonb_build_object('size', 1000, 'mimetype', 'application/pdf')),
        ('message-attachments', v_big, v_s, v_s::text, jsonb_build_object('size', 20000000, 'mimetype', 'application/pdf')),
        ('message-attachments', v_left, v_s, v_s::text, jsonb_build_object('size', 3000, 'mimetype', 'application/pdf'));
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := v_err is null;
    results := results || pg_temp.dr('F01', v_ok, 'S uploads 6 files into the conversation''s folder. ' || coalesce(v_state || ' ' || v_err, 'ok'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F02: R (the other company) uploads too.
    v_err := null; v_state := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
        ('message-attachments', v_rfile, v_r, v_r::text, jsonb_build_object('size', 40000, 'mimetype', 'application/pdf'));
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := v_err is null;
    results := results || pg_temp.dr('F02', v_ok, 'R (the receiving company) uploads into the same conversation. ' || coalesce(v_state || ' ' || v_err, 'ok'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F03: refused uploads.
    v_i := 0; v_t := '';
    for v_rec in
      select * from (values
        ('X outsider', v_x, v_x, v_req::text || '/' || gen_random_uuid()::text || '/x.pdf'),
        ('M3 staff', v_m, v_m, v_req::text || '/' || gen_random_uuid()::text || '/m.pdf'),
        ('S bad path', v_s, v_s, v_req::text || '/Brochure.pdf'),
        ('S .exe', v_s, v_s, v_req::text || '/' || gen_random_uuid()::text || '/setup.exe'),
        ('S a.pdf.exe', v_s, v_s, v_req::text || '/' || gen_random_uuid()::text || '/Invoice.pdf.exe'),
        ('S as R (owner)', v_s, v_r, v_req::text || '/' || gen_random_uuid()::text || '/as-r.pdf'),
        ('S pending request', v_s, v_s, v_pend::text || '/' || gen_random_uuid()::text || '/p.pdf'),
        ('S unknown conversation', v_s, v_s, gen_random_uuid()::text || '/' || gen_random_uuid()::text || '/q.pdf'),
        ('anon', null::uuid, null::uuid, v_req::text || '/' || gen_random_uuid()::text || '/a.pdf')
      ) as t(who, uid, owner_uid, path)
    loop
      v_err := null; v_state := null;
      begin
        if v_rec.uid is null then
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
          set local role anon;
        else
          perform set_config('request.jwt.claims', json_build_object('sub', v_rec.uid, 'role', 'authenticated')::text, true);
          set local role authenticated;
        end if;
        insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
          ('message-attachments', v_rec.path, v_rec.owner_uid, v_rec.owner_uid::text, jsonb_build_object('size', 1000, 'mimetype', 'application/pdf'));
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
      end;
      perform set_config('request.jwt.claims', '', true);
      if v_state = '42501' then v_i := v_i + 1; else v_t := v_t || format('%s: %s %s; ', v_rec.who, coalesce(v_state, 'ACCEPTED'), coalesce(v_err, '')); end if;
    end loop;
    v_ok := v_i = 9;
    results := results || pg_temp.dr('F03', v_ok, format('uploads refused (RLS) for an outsider, M3 staff, a bad path, .exe, a.pdf.exe, someone else as owner, a pending request, an unknown conversation, anon: %s of 9. %s', v_i, v_t));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F04: who sees which file BEFORE anything is sent (storage.objects SELECT: what
    -- signed links rely on): each uploader their own files, nobody else anything.
    v_i := 0; v_t := '';
    for v_rec in
      select * from (values ('S', v_s, 'big,fake,html,left,pdf,png'), ('R', v_r, 'rfile'), ('C', v_c, ''), ('X', v_x, ''), ('M', v_m, ''), ('anon', null::uuid, '')) as t(who, uid, expected)
    loop
      continue when v_rec.who = 'C' and v_rec.uid is null;
      v_err := null; v_t2 := null;
      begin
        if v_rec.uid is null then
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
          set local role anon;
        else
          perform set_config('request.jwt.claims', json_build_object('sub', v_rec.uid, 'role', 'authenticated')::text, true);
          set local role authenticated;
        end if;
        select coalesce(string_agg(k.label, ',' order by k.label), '') into v_t2
          from unnest(c_labels, array[v_big, v_fake, v_html, v_left, v_pdf, v_png, v_rfile]) as k(label, path)
         where exists (select 1 from storage.objects o where o.bucket_id = 'message-attachments' and o.name = k.path);
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text;
      end;
      perform set_config('request.jwt.claims', '', true);
      if v_err is not null or v_t2 is distinct from v_rec.expected then v_i := v_i + 1; end if;
      v_t := v_t || format('%s=[%s] ', v_rec.who, coalesce(v_t2, 'error ' || v_err));
    end loop;
    v_ok := v_i = 0;
    results := results || pg_temp.dr('F04', v_ok, 'before sending: each uploader sees only their own files, the other company and M3 nothing: ' || v_t);
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F05: S sends a file with no text, lying about its name (control character, slash,
    -- a right-to-left override), size and type: kept, with the size and type of
    -- storage and a clean name.
    v_err := null; v_state := null; v_t := null; v_json := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_messages (partner_request_id, body, attachments)
      values (v_req, '   ', jsonb_build_array(jsonb_build_object('path', v_pdf, 'name', 'Brochure' || chr(10) || '2026/v2' || chr(8238) || '.pdf', 'size', 1, 'mime', 'text/html')))
      returning id, body, attachments into v_msg1, v_t, v_json;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    perform set_config('request.jwt.claims', '', true);
    select author_user_id = v_s and author_org_id = v_os into v_b from public.conversation_messages where id = v_msg1;
    v_ok := coalesce(v_err is null and v_t = '' and jsonb_array_length(v_json) = 1
                     and v_json -> 0 ->> 'path' = v_pdf and v_json -> 0 ->> 'name' = 'Brochure 2026 v2.pdf'
                     and v_json -> 0 ->> 'size' = '52000' and v_json -> 0 ->> 'mime' = 'application/pdf'
                     and (select count(*) from jsonb_object_keys(v_json -> 0)) = 4 and v_b, false);
    results := results || pg_temp.dr('F05', v_ok, 'a file without text is sent; size, type from storage; name cleaned; author and company set. '
      || coalesce(v_state || ' ' || v_err, format('body=%L files=%s author ok=%s', v_t, v_json, v_b)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F06: S sends a text with a photo.
    v_err := null; v_state := null; v_json := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_messages (partner_request_id, body, attachments)
      values (v_req, c_text, jsonb_build_array(jsonb_build_object('path', v_png, 'name', 'harbour.png')))
      returning id, attachments into v_msg2, v_json;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_json -> 0 ->> 'mime' = 'image/png' and v_json -> 0 ->> 'size' = '230000'
                     and v_json -> 0 ->> 'name' = 'harbour.png', false);
    results := results || pg_temp.dr('F06', v_ok, 'a text with a photo is sent. ' || coalesce(v_state || ' ' || v_err, coalesce(v_json::text, 'no files')));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F07: refused messages (each with the reason the client turns into plain words).
    v_i := 0; v_t := '';
    for v_rec in
      select * from (values
        ('no text and no file', '', null::jsonb, '23514'),
        ('the other company''s file', '', jsonb_build_array(jsonb_build_object('path', v_rfile)), 'attachment_missing'),
        ('a file of another conversation', '', jsonb_build_array(jsonb_build_object('path', v_pend::text || '/' || gen_random_uuid()::text || '/x.pdf')), 'attachment_invalid'),
        ('a file never uploaded', '', jsonb_build_array(jsonb_build_object('path', v_req::text || '/' || gen_random_uuid()::text || '/ghost.pdf')), 'attachment_missing'),
        ('an .exe path', '', jsonb_build_array(jsonb_build_object('path', v_req::text || '/' || gen_random_uuid()::text || '/setup.exe')), 'attachment_invalid'),
        ('6 files', '', (select jsonb_agg(jsonb_build_object('path', v_pdf)) from generate_series(1, 6)), 'too_many_files'),
        ('the same file twice', 'two', jsonb_build_array(jsonb_build_object('path', v_png), jsonb_build_object('path', v_png)), 'attachment_invalid'),
        ('an HTML page named .pdf', '', jsonb_build_array(jsonb_build_object('path', v_html)), 'attachment_type'),
        ('a PDF named .png', '', jsonb_build_array(jsonb_build_object('path', v_fake)), 'attachment_type'),
        ('a 20 MB file', '', jsonb_build_array(jsonb_build_object('path', v_big)), 'attachment_size'),
        ('files not in a list', '', jsonb_build_object('path', v_pdf), 'attachment_invalid'),
        ('a file that is not an object', '', '["x"]'::jsonb, 'attachment_invalid'),
        ('4001 characters with a file', repeat('a', 4001), jsonb_build_array(jsonb_build_object('path', v_pdf)), '23514')
      ) as t(label, body, files, expected)
    loop
      v_err := null; v_state := null; v_hint := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into public.conversation_messages (partner_request_id, body, attachments) values (v_req, v_rec.body, v_rec.files);
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_hint = pg_exception_hint;
      end;
      perform set_config('request.jwt.claims', '', true);
      if v_rec.expected in (v_state, v_hint) then v_i := v_i + 1;
      else v_t := v_t || format('%s: got %s/%s %s; ', v_rec.label, coalesce(v_state, 'ACCEPTED'), coalesce(v_hint, ''), coalesce(v_err, '')); end if;
    end loop;
    v_ok := v_i = 13;
    results := results || pg_temp.dr('F07', v_ok, format('refused with the right reason: %s of 13. %s', v_i, v_t));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F08: still accepted: an empty file list (stored as none), and the 9 Oct client's
    -- text-only message.
    v_err := null; v_state := null; v_json := '{}'::jsonb; v_t2 := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_messages (partner_request_id, body, attachments) values (v_req, 'hello', '[]'::jsonb)
      returning id, attachments into v_msg3, v_json;
      insert into public.conversation_messages (partner_request_id, body) values (v_req, '  Text only, as the 9 Oct client sends it.  ')
      returning id, body into v_msg4, v_t2;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_json is null and v_t2 = 'Text only, as the 9 Oct client sends it.', false);
    results := results || pg_temp.dr('F08', v_ok, 'an empty list is stored as no file; a text-only message is unchanged. ' || coalesce(v_state || ' ' || v_err, 'ok'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- The run is one transaction (now() never moves): spread the messages in time.
    update public.conversation_messages set created_at = now() - interval '4 minutes' where id = v_msg3;
    update public.conversation_messages set created_at = now() - interval '3 minutes' where id = v_msg4;
    update public.conversation_messages set created_at = now() - interval '2 minutes' where id = v_msg2;
    update public.conversation_messages set created_at = now() - interval '1 minute' where id = v_msg1;

    -- F09: who sees which file once sent: the other company and S's colleague see the
    -- PDF and the photo, never what was chosen and not sent (page, fake, big, left);
    -- each uploader still their own; M3 nothing (no report).
    v_i := 0; v_t := '';
    for v_rec in
      select * from (values ('S', v_s, 'big,fake,html,left,pdf,png'), ('R', v_r, 'pdf,png,rfile'), ('C', v_c, 'pdf,png'), ('X', v_x, ''), ('M', v_m, ''), ('anon', null::uuid, '')) as t(who, uid, expected)
    loop
      continue when v_rec.who = 'C' and v_rec.uid is null;
      v_err := null; v_t2 := null;
      begin
        if v_rec.uid is null then
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
          set local role anon;
        else
          perform set_config('request.jwt.claims', json_build_object('sub', v_rec.uid, 'role', 'authenticated')::text, true);
          set local role authenticated;
        end if;
        select coalesce(string_agg(k.label, ',' order by k.label), '') into v_t2
          from unnest(c_labels, array[v_big, v_fake, v_html, v_left, v_pdf, v_png, v_rfile]) as k(label, path)
         where exists (select 1 from storage.objects o where o.bucket_id = 'message-attachments' and o.name = k.path);
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text;
      end;
      perform set_config('request.jwt.claims', '', true);
      if v_err is not null or v_t2 is distinct from v_rec.expected then v_i := v_i + 1; end if;
      v_t := v_t || format('%s=[%s] ', v_rec.who, coalesce(v_t2, 'error ' || v_err));
    end loop;
    v_ok := v_i = 0;
    results := results || pg_temp.dr('F09', v_ok, 'after sending: both companies see the sent files only, M3 nothing: ' || v_t);
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F10: nobody replaces a file; a member removes only their own file that was never
    -- sent (the client's tidy-up), not a sent one, not the other company's.
    v_t := '';
    for v_rec in
      select * from (values ('S', v_s, v_pdf, v_pdf), ('S', v_s, v_png, v_rfile), ('R', v_r, v_rfile, v_pdf), ('R', v_r, v_rfile, v_left), ('S', v_s, v_left, v_left)) as t(who, uid, upd, del)
    loop
      v_err := null; v_i := null; v_j := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_rec.uid, 'role', 'authenticated')::text, true);
        perform set_config('storage.allow_delete_query', 'true', true);
        set local role authenticated;
        update storage.objects set metadata = metadata || '{"touched": true}'::jsonb where bucket_id = 'message-attachments' and name = v_rec.upd;
        get diagnostics v_i = row_count;
        delete from storage.objects where bucket_id = 'message-attachments' and name = v_rec.del;
        get diagnostics v_j = row_count;
        reset role;
      exception when others then
        get stacked diagnostics v_err = message_text;
      end;
      perform set_config('request.jwt.claims', '', true);
      perform set_config('storage.allow_delete_query', 'false', true);
      v_t := v_t || format('%s %s/%s:%s%s; ', v_rec.who, coalesce(v_i::text, '?'), coalesce(v_j::text, '?'),
        case v_rec.del when v_pdf then 'sent' when v_rfile then 'other' when v_left then 'unsent' else '?' end, coalesce(' ' || v_err, ''));
    end loop;
    select count(*) into v_n from storage.objects
     where bucket_id = 'message-attachments' and name in (v_pdf, v_png, v_rfile) and not (metadata ? 'touched');
    select count(*) into v_k from storage.objects where bucket_id = 'message-attachments' and name = v_left;
    v_ok := v_n = 3 and v_k = 0
            and v_t = 'S 0/0:sent; S 0/0:other; R 0/0:sent; R 0/0:unsent; S 0/1:unsent; ';
    results := results || pg_temp.dr('F10', v_ok, format('updated/deleted per try: %s sent files intact %s/3, unsent own file gone %s', v_t, v_n, v_k = 0));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F11: the thread, for R, S and X.
    v_err := null; v_t := null; v_t2 := null; v_b := null; v_b2 := null; v_n := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select string_agg(case t.id when v_req then 'first' when v_msg1 then 'file' when v_msg2 then 'photo' when v_msg3 then 'hello' when v_msg4 then 'text' else 'other' end, ',' order by t.n),
             bool_and(case when t.id = v_msg1 then t.body = '' and not t.from_my_side and t.attachments -> 0 ->> 'path' = v_pdf
                           when t.id = v_msg2 then t.attachments -> 0 ->> 'mime' = 'image/png'
                           when t.id = v_req then t.is_first and t.attachments is null
                           else t.attachments is null end)
        into v_t, v_b
        from public.msg_thread(v_req) with ordinality as t(id, author_user_id, author_name, author_job_title, author_avatar_url, author_org_id,
                                                           author_org_name, body, created_at, is_first, from_my_side, is_deleted, attachments, n);
      reset role;
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select t.from_my_side into v_b2 from public.msg_thread(v_req) t where t.id = v_msg1;
      reset role;
      perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_n from public.msg_thread(v_req);
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_t = 'first,hello,text,photo,file' and v_b and v_b2 and v_n = 0, false);
    results := results || pg_temp.dr('F11', v_ok, 'msg_thread: files on their messages, oldest first, mine for S, nothing for X. '
      || coalesce(v_err, format('order=%s files ok=%s S mine=%s X rows=%s', v_t, v_b, v_b2, v_n)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F12: R's list: the last message is a file without text; 4 unread.
    v_err := null; v_n := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select c.last_message_preview as preview, c.last_attachment_count as files, c.last_attachment_name as fname,
             c.last_attachment_mime as fmime, c.unread_count as unread, c.last_from_my_side as mine
        into v_rec
        from public.msg_conversations() c where c.partner_request_id = v_req;
      v_n := public.msg_unread_count();
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_rec.preview = '' and v_rec.files = 1 and v_rec.fname = 'Brochure 2026 v2.pdf'
                     and v_rec.fmime = 'application/pdf' and v_rec.unread = 4 and not v_rec.mine and v_n >= 4, false);
    results := results || pg_temp.dr('F12', v_ok, 'msg_conversations for R: last message = a file (count, name, type), 4 unread; msg_unread_count counts them. '
      || coalesce(v_err, format('%s unread_total=%s', v_rec, v_n)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F13: the Friday digest: msg_digest_batch (unchanged) builds each preview's text
    -- from msg_unread_items' body; R's unread items carry the file-only message with
    -- an empty body, so its preview text is empty and messages-digest writes "Sent a
    -- file". (One person's items, not the whole batch: it keeps the run short.)
    select count(*) filter (where x.message_id = v_msg1 and left(regexp_replace(btrim(x.body), '\s+', ' ', 'g'), 140) = '')
      into v_n from public.msg_unread_items(v_r, null) x;
    v_b := strpos((select prosrc from pg_proc where oid = 'public.msg_digest_batch(date, integer)'::regprocedure),
                  $q$'text', left(regexp_replace(btrim(m.body), '\s+', ' ', 'g'), 140)$q$) > 0;
    v_ok := coalesce(v_n = 1 and v_b, false);
    results := results || pg_temp.dr('F13', v_ok, format('digest preview of the file-only message is empty (%s), digest text rule unchanged (%s)', v_n, v_b));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F14: "Seen": nobody of OM has opened it yet.
    v_err := null; v_n := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_n from public.msg_thread_seen(v_req) s where s.side = 'marina';
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_n = 0, false);
    results := results || pg_temp.dr('F14', v_ok, 'before R opens it, S sees no "Seen" from OM. ' || coalesce(v_err, format('rows=%s', v_n)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F15: R opens it: S sees "Seen by <R's first name>"; R sees it as their side; X and anon nothing.
    v_err := null; v_b := null; v_n := null; v_state := null; v_t := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.msg_mark_read(v_req, null);
      select s.is_my_side into v_b from public.msg_thread_seen(v_req) s where s.side = 'marina';
      reset role;
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select s.side, s.is_my_side, s.last_read_at, s.reader_first_name into v_rec from public.msg_thread_seen(v_req) s where s.side = 'marina';
      reset role;
      perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_n from public.msg_thread_seen(v_req);
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);
    begin
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      set local role anon;
      perform * from public.msg_thread_seen(v_req);
      reset role;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
    end;
    perform set_config('request.jwt.claims', '', true);
    select created_at into v_ts from public.conversation_messages where id = v_msg1;
    v_ok := coalesce(v_err is null and v_b and not v_rec.is_my_side and v_rec.last_read_at >= v_ts
                     and v_rec.reader_first_name is not distinct from v_r_first and v_n = 0 and v_state = '42501', false);
    results := results || pg_temp.dr('F15', v_ok, 'after R opens it: S sees it seen by R''s first name, R sees their own side, X nothing, anon refused. '
      || coalesce(v_err, format('S sees %s; R own side=%s; X rows=%s; anon=%s', v_rec, v_b, v_n, coalesce(v_state, 'ALLOWED'))));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F16: S opens it too: both sides show, each from the right point of view.
    v_err := null; v_t := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.msg_mark_read(v_req, null);
      reset role;
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select string_agg(format('%s:%s:%s', s.side, s.is_my_side, s.reader_first_name is not distinct from case s.side when 'partner' then v_s_first else v_r_first end), ',' order by s.side)
        into v_t from public.msg_thread_seen(v_req) s;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_t = 'marina:t:t,partner:f:t', false);
    results := results || pg_temp.dr('F16', v_ok, 'both sides read: R sees partner (S) as the other side. ' || coalesce(v_err, coalesce(v_t, 'no rows')));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F17: R reports the conversation: M3's excerpt names the files.
    v_err := null; v_t := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      insert into public.conversation_reports (partner_request_id, reason) values (v_req, 'Dry run report: a file I did not expect.')
      returning id, excerpt into v_rep, v_t;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_t like '%): [files: Brochure 2026 v2.pdf]%' and v_t like '%' || c_text || ' [files: harbour.png]%'
                     and v_t like '%' || c_first || '%', false);
    results := results || pg_temp.dr('F17', v_ok, 'the report''s excerpt lists the files of each message. ' || coalesce(v_err, right(coalesce(v_t, 'no excerpt'), 300)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F18: M3 staff and an OPEN report: they see the files the report covers (sent up
    -- to its time), not a file sent after it, not unsent ones, nothing once it is
    -- closed; they remove a covered file, not an unsent one; S cannot remove a sent
    -- file; X still sees nothing.
    v_err := null; v_t := null; v_t2 := null; v_t3 := null; v_j := null; v_k := null; v_l := null; v_n := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select coalesce(string_agg(k.label, ',' order by k.label), '') into v_t
        from unnest(c_labels, array[v_big, v_fake, v_html, v_left, v_pdf, v_png, v_rfile]) as k(label, path)
       where exists (select 1 from storage.objects o where o.bucket_id = 'message-attachments' and o.name = k.path);
      reset role;
      -- A file sent AFTER the report, then the report closed (both rolled back).
      begin
        v_late := v_req::text || '/' || gen_random_uuid()::text || '/late.pdf';
        perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
          ('message-attachments', v_late, v_s, v_s::text, jsonb_build_object('size', 900, 'mimetype', 'application/pdf'));
        insert into public.conversation_messages (partner_request_id, body, attachments)
        values (v_req, 'after the report', jsonb_build_array(jsonb_build_object('path', v_late, 'name', 'late.pdf')));
        reset role;
        update public.conversation_messages set created_at = now() + interval '1 minute' where partner_request_id = v_req and body = 'after the report';
        perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*) into v_n from storage.objects where bucket_id = 'message-attachments' and name = v_late;
        update public.conversation_reports set status = 'closed' where id = v_rep;
        select coalesce(string_agg(k.label, ',' order by k.label), '') into v_t2
          from unnest(c_labels, array[v_big, v_fake, v_html, v_left, v_pdf, v_png, v_rfile]) as k(label, path)
         where exists (select 1 from storage.objects o where o.bucket_id = 'message-attachments' and o.name = k.path);
        reset role;
        raise exception using errcode = 'DRY04', message = 'late file and closing rolled back';
      exception
        when sqlstate 'DRY04' then null;
      end;
      perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
      perform set_config('storage.allow_delete_query', 'true', true);
      set local role authenticated;
      delete from storage.objects where bucket_id = 'message-attachments' and name = v_png;
      get diagnostics v_j = row_count;
      delete from storage.objects where bucket_id = 'message-attachments' and name = v_html;
      get diagnostics v_k = row_count;
      reset role;
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      delete from storage.objects where bucket_id = 'message-attachments' and name = v_pdf;
      get diagnostics v_l = row_count;
      reset role;
      perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select coalesce(string_agg(k.label, ',' order by k.label), '') into v_t3
        from unnest(c_labels, array[v_big, v_fake, v_html, v_left, v_pdf, v_png, v_rfile]) as k(label, path)
       where exists (select 1 from storage.objects o where o.bucket_id = 'message-attachments' and o.name = k.path);
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('storage.allow_delete_query', 'false', true);
    v_ok := coalesce(v_err is null and v_t = 'pdf,png' and v_n = 0 and v_t2 = '' and v_j = 1 and v_k = 0 and v_l = 0 and v_t3 = '', false);
    results := results || pg_temp.dr('F18', v_ok, 'M3 staff with an open report: the covered files only. '
      || coalesce(v_err, format('M sees [%s]; a file sent after the report seen %s; after closing M sees [%s]; M removed covered %s, unsent %s; S removed sent %s; X sees [%s]',
                                v_t, v_n, v_t2, v_j, v_k, v_l, v_t3)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F19: what Realtime may send to whom: it checks each subscriber's SELECT under RLS.
    v_t := '';
    for v_rec in
      select * from (values ('S', v_s, 4, 1), ('R', v_r, 4, 1), ('C', v_c, 4, 1), ('X', v_x, 0, 0), ('M', v_m, 0, 1), ('anon', null::uuid, -1, 0)) as t(who, uid, msgs, reqs)
    loop
      continue when v_rec.who = 'C' and v_rec.uid is null;
      v_err := null; v_state := null; v_i := null; v_j := null;
      begin
        if v_rec.uid is null then
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
          set local role anon;
        else
          perform set_config('request.jwt.claims', json_build_object('sub', v_rec.uid, 'role', 'authenticated')::text, true);
          set local role authenticated;
        end if;
        select count(*) into v_j from public.partner_requests where id = v_req;
        select count(*) into v_i from public.conversation_messages where partner_request_id = v_req;
        reset role;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
      end;
      perform set_config('request.jwt.claims', '', true);
      v_t := v_t || format('%s msgs=%s/%s req=%s/%s; ', v_rec.who, coalesce(v_i::text, case when v_state = '42501' then '-1' else 'error ' || coalesce(v_state, '') end), v_rec.msgs,
                           coalesce(v_j::text, '?'), v_rec.reqs);
    end loop;
    v_ok := v_t !~ 'error' and v_t ~ 'S msgs=4/4 req=1/1' and v_t ~ 'R msgs=4/4 req=1/1' and v_t ~ 'X msgs=0/0 req=0/0'
            and v_t ~ 'M msgs=0/0 req=1/1' and v_t ~ 'anon msgs=-1/-1 req=0/0' and (v_c is null or v_t ~ 'C msgs=4/4 req=1/1');
    results := results || pg_temp.dr('F19', v_ok, 'rows Realtime may deliver: messages to both companies only (staff: the request, not the messages; anon: nothing): ' || v_t);
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F20: M3 removes the file-only message: no text, no file in the thread; the list moves
    -- to the photo message; the other company (and S's colleague) can no longer open its
    -- file; S, who uploaded it, still can.
    update public.conversation_messages set deleted_at = now() where id = v_msg1;
    v_err := null; v_t := null; v_t2 := '';
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select format('%s|%s|%s', t.body is null, t.attachments is null, t.is_deleted) into v_t from public.msg_thread(v_req) t where t.id = v_msg1;
      select c.last_message_preview as preview, c.last_attachment_count as files, c.last_attachment_mime as fmime
        into v_rec from public.msg_conversations() c where c.partner_request_id = v_req;
      select v_t2 || 'R=' || count(*) into v_t2 from storage.objects where bucket_id = 'message-attachments' and name = v_pdf;
      reset role;
      if v_c is not null then
        perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select v_t2 || ' C=' || count(*) into v_t2 from storage.objects where bucket_id = 'message-attachments' and name = v_pdf;
        reset role;
      end if;
      perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select v_t2 || ' S=' || count(*) into v_t2 from storage.objects where bucket_id = 'message-attachments' and name = v_pdf;
      reset role;
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);
    v_ok := coalesce(v_err is null and v_t = 't|t|t' and v_rec.preview = c_text and v_rec.files = 1 and v_rec.fmime = 'image/png'
                     and v_t2 = 'R=0' || case when v_c is not null then ' C=0' else '' end || ' S=1', false);
    results := results || pg_temp.dr('F20', v_ok, 'a removed message shows neither its text nor its files, and its file is closed to the companies. '
      || coalesce(v_err, format('%s %s files: %s', v_t, v_rec, v_t2)));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F21: OS suspended by M3: S can no longer upload or send a file; R still can upload.
    v_t := null;
    begin
      update public.organizations set access_status = 'suspended' where id = v_os;
      v_state := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
          ('message-attachments', v_req::text || '/' || gen_random_uuid()::text || '/late.pdf', v_s, v_s::text, jsonb_build_object('size', 100, 'mimetype', 'application/pdf'));
        reset role;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
      end;
      perform set_config('request.jwt.claims', '', true);
      v_t := 'S upload ' || coalesce(v_state, 'ACCEPTED');
      v_state := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into public.conversation_messages (partner_request_id, body, attachments)
        values (v_req, '', jsonb_build_array(jsonb_build_object('path', v_png)));
        reset role;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
      end;
      perform set_config('request.jwt.claims', '', true);
      v_t := v_t || ', S message ' || coalesce(v_state, 'ACCEPTED');
      v_state := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
          ('message-attachments', v_req::text || '/' || gen_random_uuid()::text || '/r2.pdf', v_r, v_r::text, jsonb_build_object('size', 100, 'mimetype', 'application/pdf'));
        reset role;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
      end;
      perform set_config('request.jwt.claims', '', true);
      v_t := v_t || ', R upload ' || coalesce(v_state, 'ACCEPTED');
      raise exception using errcode = 'DRY02', message = 'suspension rolled back';
    exception
      when sqlstate 'DRY02' then null;
    end;
    v_ok := v_t = 'S upload 42501, S message 42501, R upload ACCEPTED';
    results := results || pg_temp.dr('F21', v_ok, 'a suspended company sends no file; the other company still can: ' || coalesce(v_t, 'crashed'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F22: upload quotas: 100 files an hour, 300 a day per person (test rows rolled back).
    v_t := '';
    begin
      insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
      select 'message-attachments', v_req::text || '/' || gen_random_uuid()::text || '/q' || g || '.pdf', v_r, v_r::text,
             jsonb_build_object('size', 100, 'mimetype', 'application/pdf')
        from generate_series(1, 98) g;   -- R already uploaded 1 (F02): 99 this hour
      for v_i in 1 .. 2 loop
        v_state := null;
        begin
          perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
          set local role authenticated;
          insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
            ('message-attachments', v_req::text || '/' || gen_random_uuid()::text || '/hour' || v_i || '.pdf', v_r, v_r::text, jsonb_build_object('size', 100, 'mimetype', 'application/pdf'));
          reset role;
        exception when others then
          get stacked diagnostics v_state = returned_sqlstate;
        end;
        perform set_config('request.jwt.claims', '', true);
        v_t := v_t || format('hour #%s %s; ', 99 + v_i, coalesce(v_state, 'ACCEPTED'));
      end loop;
      raise exception using errcode = 'DRY05', message = 'hour quota rolled back';
    exception
      when sqlstate 'DRY05' then null;
    end;
    begin
      insert into storage.objects (bucket_id, name, owner, owner_id, metadata, created_at)
      select 'message-attachments', v_req::text || '/' || gen_random_uuid()::text || '/d' || g || '.pdf', v_r, v_r::text,
             jsonb_build_object('size', 100, 'mimetype', 'application/pdf'), now() - interval '5 hours'
        from generate_series(1, 299) g;  -- + F02's = 300 today, 1 this hour
      v_state := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
          ('message-attachments', v_req::text || '/' || gen_random_uuid()::text || '/day.pdf', v_r, v_r::text, jsonb_build_object('size', 100, 'mimetype', 'application/pdf'));
        reset role;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
      end;
      perform set_config('request.jwt.claims', '', true);
      v_t := v_t || format('day #301 %s', coalesce(v_state, 'ACCEPTED'));
      raise exception using errcode = 'DRY06', message = 'day quota rolled back';
    exception
      when sqlstate 'DRY06' then null;
    end;
    v_ok := v_t = 'hour #100 ACCEPTED; hour #101 42501; day #301 42501';
    results := results || pg_temp.dr('F22', v_ok, 'upload quotas: ' || v_t);
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- F23: a member of OM whose account is not verified (R set back to pending, rolled
    -- back): no upload, no message, and only their own file in sight.
    v_t := null;
    begin
      update public.profiles set access_status = 'pending' where user_id = v_r;
      v_state := null; v_t2 := null; v_hint := null;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
          ('message-attachments', v_req::text || '/' || gen_random_uuid()::text || '/u.pdf', v_r, v_r::text, jsonb_build_object('size', 100, 'mimetype', 'application/pdf'));
        reset role;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
      end;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
        set local role authenticated;
        insert into public.conversation_messages (partner_request_id, body) values (v_req, 'unverified');
        reset role;
      exception when others then
        get stacked diagnostics v_hint = returned_sqlstate;
      end;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_r, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select coalesce(string_agg(k.label, ',' order by k.label), '') into v_t2
          from unnest(c_labels, array[v_big, v_fake, v_html, v_left, v_pdf, v_png, v_rfile]) as k(label, path)
         where exists (select 1 from storage.objects o where o.bucket_id = 'message-attachments' and o.name = k.path);
        reset role;
      exception when others then
        v_t2 := 'error';
      end;
      perform set_config('request.jwt.claims', '', true);
      v_t := format('upload %s, message %s, sees [%s]', coalesce(v_state, 'ACCEPTED'), coalesce(v_hint, 'ACCEPTED'), v_t2);
      raise exception using errcode = 'DRY07', message = 'unverified rolled back';
    exception
      when sqlstate 'DRY07' then null;
    end;
    v_ok := v_t = 'upload 42501, message 42501, sees [rfile]';
    results := results || pg_temp.dr('F23', v_ok, 'an unverified member: ' || coalesce(v_t, 'crashed'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    raise exception using errcode = 'DRY01', message = 'scenario F finished';
  exception
    when sqlstate 'DRY01' then null;
    when others then
      get stacked diagnostics v_err = message_text;
      results := results || pg_temp.dr('F--', false, 'scenario F crashed: ' || v_err);
      n_fail := n_fail + 1;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('storage.allow_delete_query', 'false', true);

  /* ═══════════════════════ Z. the down script ═══════════════════════ */
  begin
    -- A file-only message written by the service role (trusted), so the down's text fix shows.
    insert into public.partner_requests (partner_user_id, marina_user_id, partner_organization_id, marina_organization_id, message, status)
    values (v_s, v_r, v_os, v_om, c_first, 'accepted') returning id into v_req;
    insert into public.conversation_messages (partner_request_id, author_user_id, author_org_id, body, attachments)
    values (v_req, v_s, v_os, '', jsonb_build_array(jsonb_build_object('path', v_req::text || '/' || gen_random_uuid()::text || '/z.pdf',
                                                                        'name', 'z.pdf', 'size', 10, 'mime', 'application/pdf')))
    returning id into v_msg1;

    v_err := null;
    begin
      execute c_down;
    exception when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    end;
    v_ok := v_err is null;
    results := results || pg_temp.dr('Z01', v_ok, 'the down script runs without error. ' || coalesce(v_state || ' ' || v_err, 'ok'));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- Z02: the 9 Oct state is back.
    select count(*) into v_i from information_schema.columns
     where table_schema = 'public' and table_name = 'conversation_messages' and column_name = 'attachments';
    select pg_get_constraintdef(oid) into v_t from pg_constraint
     where conrelid = 'public.conversation_messages'::regclass and conname = 'conversation_messages_body_length';
    select count(*) into v_j from pg_constraint
     where conrelid = 'public.conversation_messages'::regclass and conname = 'conversation_messages_attachments_shape';
    select body into v_t2 from public.conversation_messages where id = v_msg1;
    v_ok := coalesce(v_i = 0 and v_j = 0 and v_t = (select v from _dr_before where k = 'constraint body')
                     and v_t2 = '[A file was sent here]', false);
    results := results || pg_temp.dr('Z02', v_ok, format('column gone (%s), shape rule gone (%s), body rule restored: %s; a file-only message reads %L',
      v_i, v_j, v_t, v_t2));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    -- Z03: policies, publication and functions as before; the empty bucket removed.
    select count(*) filter (where b.k is null) + count(*) filter (where a.k is null) + count(*) filter (where a.v <> b.v) into v_i
      from (select 'policy ' || schemaname || '.' || tablename || '.' || policyname as k,
                   permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') as v
              from pg_policies
             where (schemaname = 'storage' and tablename = 'objects')
                or (schemaname = 'public' and tablename in ('partner_requests', 'conversation_messages', 'conversation_reads', 'conversation_reports'))) a
      full join (select k, v from _dr_before where k like 'policy %') b on a.k = b.k;
    select count(*) into v_j
      from (select 'pub ' || schemaname || '.' || tablename as k from pg_publication_tables where pubname = 'supabase_realtime') a
      full join (select k from _dr_before where k like 'pub %') b on a.k = b.k
     where a.k is null or b.k is null;
    select count(*) into v_k from storage.buckets where id = 'message-attachments';
    select count(*) into v_l from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('msg_thread_seen', 'msg_attachment_request', 'msg_attachment_mime_ok', 'msg_attachment_ext_matches',
                       'msg_attachment_display_name', 'msg_attachment_can_upload', 'msg_attachment_can_read',
                       'msg_attachment_staff_access', 'msg_attachment_staff_can_delete', 'msg_attachment_unsent');
    v_ok := coalesce(v_i = 0 and v_j = 0 and v_k = 0 and v_l = 0
      and pg_get_function_result('public.msg_thread(uuid)'::regprocedure) = (select v from _dr_before where k = 'fnresult msg_thread')
      and pg_get_function_result('public.msg_conversations()'::regprocedure) = (select v from _dr_before where k = 'fnresult msg_conversations')
      and not has_function_privilege('anon', 'public.msg_thread(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.msg_conversations()', 'execute')
      and (select prosrc from pg_proc where oid = 'public.conversation_messages_before_insert()'::regprocedure) not like '%attachments%'
      and (select prosrc from pg_proc where oid = 'public.msg_report_excerpt(uuid)'::regprocedure) not like '%attachments%', false);
    results := results || pg_temp.dr('Z03', v_ok, format('policy differences %s, publication differences %s, bucket left %s, new functions left %s; msg_thread / msg_conversations / trigger / excerpt as on 9 Oct',
      v_i, v_j, v_k, v_l));
    n_pass := n_pass + coalesce(v_ok, false)::int; n_fail := n_fail + (not coalesce(v_ok, false))::int;

    raise exception using errcode = 'DRY03', message = 'scenario Z finished';
  exception
    when sqlstate 'DRY03' then null;
    when others then
      get stacked diagnostics v_err = message_text;
      results := results || pg_temp.dr('Z--', false, 'scenario Z crashed: ' || v_err);
      n_fail := n_fail + 1;
  end;
  perform set_config('request.jwt.claims', '', true);

  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (messaging v2, run %s)', n_pass, n_fail, now()) || results;
end
$dryrun$;
