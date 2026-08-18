-- Both architecture storage policies asked their question by sub-selecting
-- sm_architecture_file inline. A policy expression runs with the CALLER's
-- privileges, so RLS on that table applies too — and its only select policy is
-- sm_is_staff(). For everyone who is not staff the sub-select therefore returns
-- nothing, and both policies drew the wrong conclusion from that silence:
--
--   event_media_arch_submission_jury  EXISTS(...)     -> false -> a juror could
--     never open a panel they were assigned. Invisible until now only because
--     the event had no architecture assignments for anyone to click.
--
--   sm_event_partner_read_media       NOT EXISTS(...) -> true  -> the clause
--     meant to keep competition submissions away from event partners let all 9
--     through instead. Verified: a Yachting Ventures account could read every
--     panel of the blind competition.
--
-- Same cause, opposite symptoms. Both now ask a SECURITY DEFINER function, which
-- sees the table regardless of the caller, so the answer is the true one.
--
-- Worth knowing: several other event-media policies use the same inline
-- sub-select shape against tables with their own RLS (sm_ecat_page, sm_invoice,
-- sm_marina_extra, sm_ecat_comment). They are left alone here because they are
-- not implicated in this bug and each needs its own check, but the pattern is
-- the same and they are worth auditing.

-- Is this object a registered architecture submission file?
create or replace function public.sm_is_arch_submission_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from public.sm_architecture_file f where f.file_path = p_name);
$function$;

-- Is the CALLER a juror assigned to the entry this object belongs to?
create or replace function public.sm_is_juror_for_arch_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
      from public.sm_architecture_file f
      join public.sm_jury_assignment ja on ja.entry_role_assignment_id = f.role_assignment_id
     where f.file_path = p_name
       and ja.juror_user_id = auth.uid());
$function$;

comment on function public.sm_is_arch_submission_file(text) is
  'True when the storage object is a submitted architecture competition file. SECURITY DEFINER so callers without read on sm_architecture_file still get a truthful answer.';
comment on function public.sm_is_juror_for_arch_file(text) is
  'True when the calling juror is assigned to the entry that owns this submission file.';

-- The juror read, restored.
drop policy if exists event_media_arch_submission_jury on storage.objects;
create policy event_media_arch_submission_jury on storage.objects
  for select
  using (bucket_id = 'event-media' and public.sm_is_juror_for_arch_file(name));

-- The partner exclusion, made real. Everything else about this policy is
-- unchanged: partners keep every other event-media asset.
drop policy if exists sm_event_partner_read_media on storage.objects;
create policy sm_event_partner_read_media on storage.objects
  for select
  using (
    bucket_id = 'event-media'
    and exists (select 1 from public.sm_event_partner ep where ep.user_id = auth.uid())
    and name not like 'architecture-pack/%'
    and name not like 'invoices/%'
    and not public.sm_is_arch_submission_file(name));
