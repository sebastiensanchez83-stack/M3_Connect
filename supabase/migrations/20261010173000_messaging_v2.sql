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
