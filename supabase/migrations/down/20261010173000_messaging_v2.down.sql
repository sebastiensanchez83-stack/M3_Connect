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
DROP POLICY IF EXISTS message_attachments_delete_staff ON storage.objects;
DROP FUNCTION IF EXISTS public.msg_attachment_staff_can_delete(text);
DROP FUNCTION IF EXISTS public.msg_attachment_can_read(text);
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

DROP FUNCTION IF EXISTS public.msg_attachment_mime_ok(text);
DROP FUNCTION IF EXISTS public.msg_attachment_request(text);
