-- Applied to the remote project via the Supabase MCP; kept here for traceability.
-- 1) The storage policies added for the ad-banners bucket had NO bucket_id predicate
-- (their whole condition was is_moderator()), and storage.objects policies are OR'd —
-- so every moderator had INSERT/UPDATE/DELETE/SELECT on EVERY bucket, including
-- event-media (SM26 architecture submissions, invoices), org-documents and
-- sponsorship-files. Re-scoped to the bucket they were written for. Verified safe:
-- each other bucket already has its own scoped staff/moderator policy.
drop policy if exists "Admin can update banners 1awnrj1_0" on storage.objects;
drop policy if exists "Admin can update banners 1awnrj1_1" on storage.objects;
drop policy if exists "Admins can delete banners 1awnrj1_0" on storage.objects;
drop policy if exists "Admins can delete banners 1awnrj1_1" on storage.objects;
drop policy if exists "Admins can upload banners 1awnrj1_0" on storage.objects;

create policy "ad_banners_moderator_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'ad-banners' and is_moderator());
create policy "ad_banners_moderator_update" on storage.objects
  for update to authenticated using (bucket_id = 'ad-banners' and is_moderator())
  with check (bucket_id = 'ad-banners' and is_moderator());
create policy "ad_banners_moderator_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'ad-banners' and is_moderator());

-- 2) The counters were SECURITY DEFINER, callable by anyone holding the publishable
-- key, and blindly incremented whatever uuid they were handed — including inactive,
-- expired or scheduled banners. Signature deliberately UNCHANGED: adding a defaulted
-- argument would create an overload and PostgREST would start failing PGRST203
-- silently, since both call sites are fire-and-forget.
create or replace function public.increment_banner_impressions(banner_id uuid)
returns void language sql security definer set search_path to 'public','pg_temp'
as $function$
  update ad_banners set impression_count = impression_count + 1
   where id = banner_id and is_active
     and (start_date is null or start_date <= now())
     and (end_date is null or end_date >= now());
$function$;

create or replace function public.increment_banner_clicks(banner_id uuid)
returns void language sql security definer set search_path to 'public','pg_temp'
as $function$
  update ad_banners set click_count = click_count + 1
   where id = banner_id and is_active
     and (start_date is null or start_date <= now())
     and (end_date is null or end_date >= now());
$function$;

-- 3) updated_at was never maintained, so there was no way to tell when a campaign
-- was last edited or deactivated.
create or replace function public.ad_banners_set_updated_at()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $function$ begin new.updated_at := now(); return new; end $function$;

drop trigger if exists ad_banners_set_updated_at_trg on public.ad_banners;
create trigger ad_banners_set_updated_at_trg before update on public.ad_banners
  for each row execute function public.ad_banners_set_updated_at();
