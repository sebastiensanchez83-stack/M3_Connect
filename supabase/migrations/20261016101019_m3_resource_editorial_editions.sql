-- A separate editorial edition prevents an SMC source article or a private
-- work-in-progress from being copied to M3 merely because sharing is enabled.
create table public.resource_m3_editions (
  resource_id uuid primary key references public.resources(id) on delete cascade,
  content_html text not null default '',
  is_ready boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint resource_m3_editions_size check (octet_length(content_html) <= 100000),
  constraint resource_m3_editions_ready_content check (
    not is_ready or btrim(regexp_replace(content_html, '<[^>]*>', '', 'g')) <> ''
  )
);

comment on table public.resource_m3_editions is
  'Distinct M3 editorial analysis. Only ready editions of public, published, M3-shared resources are available to the public RSS reader.';

create function public.touch_resource_m3_edition()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.touch_resource_m3_edition() from public, anon, authenticated;
create trigger resource_m3_editions_updated_at
before update on public.resource_m3_editions
for each row execute function public.touch_resource_m3_edition();

alter table public.resource_m3_editions enable row level security;
revoke all on public.resource_m3_editions from anon, authenticated;
grant select on public.resource_m3_editions to anon, authenticated;
grant insert, update on public.resource_m3_editions to authenticated;
grant all on public.resource_m3_editions to service_role;

create policy resource_m3_editions_public_read on public.resource_m3_editions
for select to anon, authenticated using (
  is_ready and exists (
    select 1 from public.resources r
    where r.id = resource_id and r.published and r.access_level = 'public' and r.share_to_m3
  )
);
create policy resource_m3_editions_admin_read on public.resource_m3_editions
for select to authenticated using ((select public.is_admin()));
create policy resource_m3_editions_admin_insert on public.resource_m3_editions
for insert to authenticated with check ((select public.is_admin()));
create policy resource_m3_editions_admin_update on public.resource_m3_editions
for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
