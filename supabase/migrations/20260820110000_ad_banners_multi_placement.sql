-- Applied to the remote project via the Supabase MCP; kept here for traceability.
-- One advert, many pages. `placement` (a single page) becomes `placements` (a set),
-- so a creative is uploaded ONCE and ticked onto every page it runs on. Additive:
-- the old column stays and is kept in sync by a trigger, so previously-deployed
-- code keeps working and a front-end rollback needs no DB rollback.

-- 0) Permanent archive of the pre-merge rows — this is the per-page history
-- (Skytopia homepage 219 vs marketplace 32) that the merge sums away.
create table if not exists public.ad_banners_archive_premerge as
  select *, now() as archived_at from public.ad_banners;
alter table public.ad_banners_archive_premerge enable row level security;
drop policy if exists ad_banners_archive_staff on public.ad_banners_archive_premerge;
create policy ad_banners_archive_staff on public.ad_banners_archive_premerge
  for select to authenticated using (is_moderator());

-- 1) New source of truth, 2) backfilled BEFORE any constraint can reject a row.
alter table public.ad_banners add column if not exists placements text[] not null default '{}';
update public.ad_banners set placements = array[placement] where cardinality(placements) = 0;

-- 3) Keep both columns in step BOTH ways, so old code writing only `placement`
-- still produces a valid row.
create or replace function public.ad_banners_sync_placements()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $function$
begin
  if new.placements is null or cardinality(new.placements) = 0 then
    new.placements := array[new.placement];
  elsif new.placement is distinct from new.placements[1] then
    new.placement := new.placements[1];
  end if;
  return new;
end $function$;

drop trigger if exists ad_banners_sync_placements_trg on public.ad_banners;
create trigger ad_banners_sync_placements_trg before insert or update on public.ad_banners
  for each row execute function public.ad_banners_sync_placements();

-- 4) Consolidate duplicates: one advert per (organization, target URL). Grouping on
-- target_url — never title — is what reunites the drifted "Smart Marina 2026" row
-- (2,102 impressions) with its three "SM 26" siblings. 9 rows -> 3.
with grp as (
  select coalesce(organization_id::text,'~')||'|'||target_url as k, id,
         row_number() over (partition by coalesce(organization_id::text,'~')||'|'||target_url
                            order by impression_count desc, created_at) as rn
  from public.ad_banners
),
agg as (
  select g.k, (array_agg(g.id order by g.rn))[1] as survivor_id,
         array_agg(distinct b.placement) as all_placements,
         sum(b.impression_count) as impr, sum(b.click_count) as clicks,
         max(b.end_date) as end_date, min(b.start_date) as start_date
  from grp g join public.ad_banners b on b.id = g.id
  group by g.k having count(*) > 1
)
update public.ad_banners b
   set placements = a.all_placements, impression_count = a.impr, click_count = a.clicks,
       end_date = a.end_date, start_date = a.start_date
  from agg a where b.id = a.survivor_id;

delete from public.ad_banners b using (
  select id from (
    select id, row_number() over (partition by coalesce(organization_id::text,'~')||'|'||target_url
                                  order by impression_count desc, created_at) rn
    from public.ad_banners_archive_premerge
  ) x where x.rn > 1
) losers where b.id = losers.id;

-- 5) Refuse to finish if a single impression or click went missing.
do $$
declare v_bi bigint; v_ai bigint; v_bc bigint; v_ac bigint;
begin
  select sum(impression_count), sum(click_count) into v_bi, v_bc from public.ad_banners_archive_premerge;
  select sum(impression_count), sum(click_count) into v_ai, v_ac from public.ad_banners;
  if v_ai < v_bi or v_ac < v_bc then
    raise exception 'Merge would lose stats: impressions %->%, clicks %->%', v_bi, v_ai, v_bc, v_ac;
  end if;
end $$;

-- 6) Guard rails: sponsor pages and site announcements must never mix in one advert.
alter table public.ad_banners drop constraint if exists ad_banners_placements_check;
alter table public.ad_banners add constraint ad_banners_placements_check check (
  cardinality(placements) > 0 and (
    placements <@ array['homepage','marketplace','resources','events']::text[]
    or placements <@ array['announcement_top','announcement_popup']::text[]
  )
);
create index if not exists ad_banners_placements_gin on public.ad_banners using gin (placements);
