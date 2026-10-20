-- Readable addresses for articles and events (Victor, 20 Oct 2026: "les liens pour articles ou
-- autre, que ce soit des liens avec le nom de l'article ou de l'evenement ou de la societe, pour
-- le SEO, car actuellement c'est des chiffres"). /resources/<slug> and /events/<slug> instead of
-- /resources/<uuid> and /events/<uuid>; companies already use /organizations/<slug>.
-- NOT APPLIED. Apply with Victor's OK, after the dry run
-- supabase/dryrun/20261020160000_readable_slugs.dryrun.sql (it runs this file, then its down, in
-- one rolled-back transaction). Down: supabase/migrations/down/20261020160000_readable_slugs.down.sql.
-- Independent of every other pending file; any order. Apply it BEFORE the redesign code that
-- reads slugs reaches production: that code copes with the column missing (id addresses, as
-- today), it only shows readable addresses once this is in.
--
-- ADDITIVE ONLY. Nothing existing is redefined; no policy of resources or events changes. The
-- live site (main) never names a slug: its inserts and updates keep their exact shape and can
-- never fail because of an address (the trigger picks a free one). Its selects are unchanged.
--
--  1. public.smc_slugify(text): a title -> an address. public.smc_fold (lower case, unaccent,
--     curly quotes and dashes made plain), "&" -> " and ", apostrophes dropped ("Europe's" ->
--     "europes"), every run of other characters -> "-", trimmed, then at most 80 characters cut
--     at a word boundary. May return '' (a title of emoji only): the trigger then uses
--     "article" / "event". Immutable.
--  2. resources.slug and events.slug: unique, lowercase a-z 0-9 words joined by "-", never shaped
--     like a UUID (the pages and the edge function read a UUID as an id first), NOT NULL after
--     the backfill. Readable by whoever may read the row (the tables' grants and policies).
--     Two flags kept by the trigger alone (whatever a client sends is overwritten):
--       resources.slug_auto / events.slug_auto: the address is the automatic one (from the
--       title), false once someone chose it (an explicit slug). Recorded, never guessed from the
--       address's shape: a hand-picked "awards-2026" is not mistaken for "awards" + "-2026".
--       events.slug_public: the event has been public (published not false) at least once.
--       Articles need no such flag: published_at is stamped at the first publication and never
--       cleared (trg_resources_stamp_published_at, 20261006193715).
--  3. resource_slug_history / event_slug_history: the addresses a row had while it had been
--     public at least once. Such an old address keeps leading to the row's current one, for ever
--     (until the row is deleted). An address a row only had while it had never been public
--     (a draft following its title, or changed by hand before publication) is not kept: nobody
--     could have linked to it, and keeping it would take it away from later records and send
--     its visitors to the wrong one. Written only by the trigger; no reader has direct access
--     (staff can list them).
--  4. One BEFORE trigger function for both tables (public.smc_slug_assign):
--     - INSERT without a slug (every insert of the live site, admin_save_event,
--       publish_resource_from_draft, scripts): from the title; if that address is used by another
--       row, now or before (history), "-2", "-3"... Never refuses. One assignment at a time per
--       table (transaction advisory lock): two inserts of the same title cannot both take it.
--       slug_auto true.
--     - A slug given explicitly (the redesign's admin editors): normalised by smc_slugify, then
--       refused when empty or UUID-shaped (22023 slug_invalid) or used by another row now or
--       before (23505 slug_taken). Taking back one of the row's own old addresses is allowed.
--       slug_auto false.
--     - UPDATE that leaves the slug alone: the address does not move when the title is edited.
--       One exception: a row that has never been public (articles: published not true and no
--       published_at; events: published false and slug_public false) whose address is still
--       the automatic one (slug_auto) follows the new title (a clone "X (copy)" or an
--       "Untitled" draft gets its real address before anyone sees it). Once public, even if
--       unpublished or hidden later, never again.
--     - UPDATE setting the slug to null or '': a fresh automatic address from the title.
--     One AFTER trigger function (public.smc_slug_remember) puts a replaced address in the
--     history when the row had been public before that update, and always takes the new one
--     out of the row's own history.
--  5. Two lookups for old addresses, public.resource_slug_lookup(text) and
--     public.event_slug_lookup(text): the current slug of the row an old address belonged to,
--     ONLY when the caller may open that row today, else null.
--       articles: published and public for anyone; published and can_access_resource() for a
--       signed-in reader; everything for staff (is_moderator()). Exactly the rows the select
--       policies of resources give (resources_anon_public, resources_select_by_access_level).
--       events: the same, and never an unpublished event (published = false) except for staff.
--       Narrower than the events policies, which let anyone read unpublished public events (the
--       pages hide them); a lookup must not make a draft discoverable.
--     STABLE (callable with GET by the edge function), SECURITY DEFINER (the history has no
--     reader grant), search_path ''.
--  6. Backfill: every existing row gets its address, oldest first; the Rendezvous 6th edition's
--     is set by name first (src/lib/seoMeta.ts RENDEZVOUS_6TH_SLUG links to it; set by name, it
--     is not automatic and never follows its title). The two existing BEFORE UPDATE triggers of
--     resources are switched off around the backfill and on again: updated_at (the sitemap's
--     lastmod, the Article JSON-LD's dateModified) and published_at (the RSS pubDate) stay
--     exactly as they are.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name in ('resources', 'events')
                and c.column_name in ('slug', 'slug_auto', 'slug_public'))
     or to_regclass('public.resource_slug_history') is not null
     or to_regclass('public.event_slug_history') is not null
     or to_regprocedure('public.smc_slugify(text)') is not null
     or to_regprocedure('public.smc_slug_assign()') is not null
     or to_regprocedure('public.smc_slug_remember()') is not null
     or to_regprocedure('public.resource_slug_lookup(text)') is not null
     or to_regprocedure('public.event_slug_lookup(text)') is not null then
    raise exception 'readable_slugs: already installed (or partly)';
  end if;
  -- The lookups repeat the select policies' rules through these two functions, as read on 20 Oct.
  if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.is_moderator()'))
       is distinct from 'cb9c826f94db460c5b63f9830ae12361'
     or (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.can_access_resource(text)'))
       is distinct from '2fcf0a1a840a7be68a2fc2467a408c6e' then
    raise exception 'readable_slugs: is_moderator() or can_access_resource() changed since 20 Oct; check the lookups again';
  end if;
  -- The select policies the lookups mirror, unchanged.
  if (select count(*) from pg_policies pl
       where pl.schemaname = 'public'
         and ((pl.tablename, pl.policyname) in (('resources', 'resources_anon_public'), ('resources', 'resources_select_by_access_level'),
                                                 ('events', 'events_anon_public'), ('events', 'events_select_by_access_level')))
         and pl.cmd = 'SELECT') <> 4 then
    raise exception 'readable_slugs: the select policies of resources / events are not the ones read on 20 Oct';
  end if;
  -- smc_fold behaves as read on 20 Oct ("Ca ete - Aesir's & co", accents and the curly apostrophe as non-ASCII).
  if public.smc_fold(chr(199) || 'a ' || chr(233) || 't' || chr(233) || ' ' || chr(8212) || ' ' || chr(198) || 'sir' || chr(8217) || 's & co')
       is distinct from 'ca ete - aesir''s & co' then
    raise exception 'readable_slugs: public.smc_fold() does not fold as expected';
  end if;
  -- The two triggers switched off around the backfill are on (so switching them on again restores them).
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.resources'::regclass
         and t.tgname in ('trg_resources_updated_at', 'trg_resources_stamp_published_at')
         and t.tgenabled::text = 'O') <> 2 then
    raise exception 'readable_slugs: trg_resources_updated_at / trg_resources_stamp_published_at are not both enabled';
  end if;
  -- "Ever public" for an article is published_at: it must still be stamped at the first publication, never cleared.
  if (select position('published_at := now()' in p.prosrc) > 0 and position('published_at := null' in p.prosrc) = 0
        from pg_proc p where p.oid = to_regprocedure('public.resources_stamp_published_at()')) is not true then
    raise exception 'readable_slugs: public.resources_stamp_published_at() is not the one read on 20 Oct';
  end if;
end
$pre$;

-- 1. Title -> address ---------------------------------------------------------------------------
create function public.smc_slugify(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $fn$
  select btrim(case when length(x.s) <= 80 then x.s
                    when substr(x.s, 81, 1) = '-' then left(x.s, 80)
                    when position('-' in left(x.s, 80)) > 0 then regexp_replace(left(x.s, 80), '-[^-]*$', '')
                    else left(x.s, 80) end, '-')
    from (select btrim(regexp_replace(replace(replace(public.smc_fold(p_text), '&', ' and '), '''', ''),
                                      '[^a-z0-9]+', '-', 'g'), '-') as s) as x
$fn$;
comment on function public.smc_slugify(text) is
  'A title as a web address: smc_fold (lower case, unaccent), "&" as "and", apostrophes dropped, other characters as "-", at most 80 characters cut at a word boundary. Can be empty. Mirrored by slugifyTitle() in src/lib/slugRoutes.ts (the database has the last word). 20261020160000.';
revoke all on function public.smc_slugify(text) from public;
grant execute on function public.smc_slugify(text) to anon, authenticated, service_role;

-- 2. The columns (unique and format-checked now, NOT NULL after the backfill) -------------------
alter table public.resources add column slug text
  constraint resources_slug_key unique
  constraint resources_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                                          and slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
comment on column public.resources.slug is
  'The article''s web address: /resources/<slug>. Set from the title on insert, then stable (trigger trg_resources_slug_assign); old addresses in resource_slug_history keep redirecting. 20261020160000.';
alter table public.resources add column slug_auto boolean not null default true;
comment on column public.resources.slug_auto is
  'True while the address is the automatic one (from the title); false once chosen explicitly. Kept by trg_resources_slug_assign alone (a value sent by a client is overwritten). 20261020160000.';
alter table public.events add column slug text
  constraint events_slug_key unique
  constraint events_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                                       and slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
comment on column public.events.slug is
  'The event''s web address: /events/<slug>. Not gl_event.slug (the registration page /register/<slug>). Set from the title on insert, then stable (trigger events_slug_assign); old addresses in event_slug_history keep redirecting. 20261020160000.';
alter table public.events add column slug_auto boolean not null default true;
comment on column public.events.slug_auto is
  'True while the address is the automatic one (from the title); false once chosen explicitly. Kept by events_slug_assign alone (a value sent by a client is overwritten). 20261020160000.';
alter table public.events add column slug_public boolean not null default false;
comment on column public.events.slug_public is
  'The event has been public (published not false) at least once: its address no longer follows the title, and a replaced one keeps redirecting. Kept by events_slug_assign alone; never goes back to false. 20261020160000.';

-- 3. The old addresses ---------------------------------------------------------------------------
create table public.resource_slug_history (
  slug text not null,
  resource_id uuid not null references public.resources(id) on delete cascade,
  replaced_at timestamptz not null default now(),
  constraint resource_slug_history_pkey primary key (slug)
);
create index resource_slug_history_resource_idx on public.resource_slug_history (resource_id);
comment on table public.resource_slug_history is
  'Addresses an article had once it had been published (/resources/<slug>): they redirect to its current one, for ever. Written only by the trigger trg_resources_slug_remember; read through public.resource_slug_lookup(), which applies the article''s visibility; staff can list them. 20261020160000.';
alter table public.resource_slug_history enable row level security;
revoke all on table public.resource_slug_history from public, anon, authenticated;
grant select on table public.resource_slug_history to authenticated;
grant all on table public.resource_slug_history to service_role;
create policy resource_slug_history_staff_read on public.resource_slug_history
  for select to authenticated using ((select public.is_moderator()));

create table public.event_slug_history (
  slug text not null,
  event_id uuid not null references public.events(id) on delete cascade,
  replaced_at timestamptz not null default now(),
  constraint event_slug_history_pkey primary key (slug)
);
create index event_slug_history_event_idx on public.event_slug_history (event_id);
comment on table public.event_slug_history is
  'Addresses an event had once it had been public (/events/<slug>): they redirect to its current one, for ever. Written only by the trigger events_slug_remember; read through public.event_slug_lookup(), which applies the event''s visibility (never an unpublished event, except for staff); staff can list them. 20261020160000.';
alter table public.event_slug_history enable row level security;
revoke all on table public.event_slug_history from public, anon, authenticated;
grant select on table public.event_slug_history to authenticated;
grant all on table public.event_slug_history to service_role;
create policy event_slug_history_staff_read on public.event_slug_history
  for select to authenticated using ((select public.is_moderator()));

-- 4. The triggers ------------------------------------------------------------------------------
create function public.smc_slug_assign()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_word text;
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_asked text;
  v_base text;
  v_try text;
  v_n integer := 1;
  v_taken boolean;
  v_was_public boolean := false;
begin
  -- Whether the row had been public before this statement (from then on its address is frozen).
  if tg_table_name = 'resources' then
    v_word := 'article';
    if tg_op = 'UPDATE' then
      -- published_at: stamped at the first publication, never cleared (trg_resources_stamp_published_at).
      v_was_public := old.published is true or old.published_at is not null;
    end if;
  elsif tg_table_name = 'events' then
    v_word := 'event';
    -- Events have no publication date: slug_public records it, here only, before any return
    -- (this trigger also fires on a publish-only or hide-only save). Never back to false.
    if tg_op = 'UPDATE' then
      v_was_public := old.published is not false or coalesce(old.slug_public, false);
      new.slug_public := v_was_public or new.published is not false;
    else
      new.slug_public := new.published is not false;
    end if;
  else
    raise exception 'smc_slug_assign: unexpected table %', tg_table_name;
  end if;

  v_asked := nullif(btrim(coalesce(new.slug, '')), '');
  if tg_op = 'UPDATE' then
    if new.slug is not distinct from old.slug and old.slug is not null then
      -- The address was left alone: it stays, and so does its origin (whatever a client sent)...
      new.slug_auto := old.slug_auto;
      if new.title is not distinct from old.title or v_was_public or not old.slug_auto then
        return new;
      end if;
      -- ...except the automatic address of a row that was never public: it follows the title.
      v_asked := null;
    end if;
  end if;

  -- One assignment at a time per table, until the end of the transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.' || tg_table_name || '.slug'));

  if v_asked is not null then
    -- Chosen by hand: normalised, and refused rather than changed.
    v_base := public.smc_slugify(v_asked);
    if v_base is null or v_base = '' or v_base ~ v_uuid_re then
      raise exception using errcode = '22023', message = 'slug_invalid',
        detail = 'A web address needs at least one letter or digit, and cannot look like an id.';
    end if;
    if tg_table_name = 'resources' then
      v_taken := exists (select 1 from public.resources r where r.slug = v_base and r.id <> new.id)
              or exists (select 1 from public.resource_slug_history h where h.slug = v_base and h.resource_id <> new.id);
    else
      v_taken := exists (select 1 from public.events e where e.slug = v_base and e.id <> new.id)
              or exists (select 1 from public.event_slug_history h where h.slug = v_base and h.event_id <> new.id);
    end if;
    if v_taken then
      raise exception using errcode = '23505', message = 'slug_taken',
        detail = format('The web address "%s" is used by another %s, now or before.', v_base, v_word);
    end if;
    new.slug := v_base;
    new.slug_auto := false;
    return new;
  end if;

  -- Automatic: from the title, with the first free suffix. Never refuses.
  v_base := coalesce(nullif(public.smc_slugify(new.title), ''), v_word);
  if v_base ~ v_uuid_re then
    v_base := v_word || '-' || v_base;
  end if;
  v_try := v_base;
  loop
    if tg_table_name = 'resources' then
      v_taken := exists (select 1 from public.resources r where r.slug = v_try and r.id <> new.id)
              or exists (select 1 from public.resource_slug_history h where h.slug = v_try and h.resource_id <> new.id);
    else
      v_taken := exists (select 1 from public.events e where e.slug = v_try and e.id <> new.id)
              or exists (select 1 from public.event_slug_history h where h.slug = v_try and h.event_id <> new.id);
    end if;
    exit when not v_taken;
    v_n := v_n + 1;
    if v_n > 100000 then
      raise exception 'smc_slug_assign: no free address for %', v_base;
    end if;
    v_try := v_base || '-' || v_n;
  end loop;
  new.slug := v_try;
  new.slug_auto := true;
  return new;
end;
$fn$;
comment on function public.smc_slug_assign() is
  'BEFORE INSERT / UPDATE OF slug, title, slug_auto (events: and published, slug_public) on resources and events: the row''s web address. Automatic from the title (first free "-N", slug_auto true), never refused; an explicit one is normalised and refused when invalid (22023 slug_invalid) or used by another row now or before (23505 slug_taken), slug_auto false; stable when the title changes, except the automatic address of a row that was never public (articles: published_at; events: slug_public, kept here). 20261020160000.';
revoke all on function public.smc_slug_assign() from public, anon, authenticated;

create function public.smc_slug_remember()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  -- The replaced address is kept only when the row had been public before this update: an
  -- address nobody could see redirects nowhere and stays free for other rows. The row's new
  -- address always leaves its own history (a row taking back one of its old addresses).
  if tg_table_name = 'resources' then
    if old.published is true or old.published_at is not null then
      insert into public.resource_slug_history (slug, resource_id) values (old.slug, new.id)
        on conflict (slug) do nothing;
    end if;
    delete from public.resource_slug_history h where h.slug = new.slug and h.resource_id = new.id;
  elsif tg_table_name = 'events' then
    if old.published is not false or coalesce(old.slug_public, false) then
      insert into public.event_slug_history (slug, event_id) values (old.slug, new.id)
        on conflict (slug) do nothing;
    end if;
    delete from public.event_slug_history h where h.slug = new.slug and h.event_id = new.id;
  end if;
  return null;
end;
$fn$;
comment on function public.smc_slug_remember() is
  'AFTER UPDATE on resources and events, when the address changed: the old one goes to the history (it keeps redirecting) when the row had been public before (articles: published or published_at; events: published not false or slug_public), the new one leaves the row''s history. 20261020160000.';
revoke all on function public.smc_slug_remember() from public, anon, authenticated;

-- slug_auto in the column lists: a client writing it alone fires the trigger, which puts it back.
create trigger trg_resources_slug_assign
  before insert or update of slug, title, slug_auto on public.resources
  for each row execute function public.smc_slug_assign();
comment on trigger trg_resources_slug_assign on public.resources is 'The article''s web address (public.smc_slug_assign). 20261020160000.';
-- Not "UPDATE OF slug": a change made by the BEFORE trigger (a draft following its title) must be seen too.
create trigger trg_resources_slug_remember
  after update on public.resources
  for each row when (old.slug is distinct from new.slug and old.slug is not null)
  execute function public.smc_slug_remember();
comment on trigger trg_resources_slug_remember on public.resources is 'Keeps the article''s replaced address (public.smc_slug_remember). 20261020160000.';
-- published and slug_public too: a publish-only or hide-only save records slug_public, and a value a client sends is put back.
create trigger events_slug_assign
  before insert or update of slug, title, slug_auto, published, slug_public on public.events
  for each row execute function public.smc_slug_assign();
comment on trigger events_slug_assign on public.events is 'The event''s web address (public.smc_slug_assign). 20261020160000.';
create trigger events_slug_remember
  after update on public.events
  for each row when (old.slug is distinct from new.slug and old.slug is not null)
  execute function public.smc_slug_remember();
comment on trigger events_slug_remember on public.events is 'Keeps the event''s replaced address (public.smc_slug_remember). 20261020160000.';

-- 5. Old address -> current one, when the caller may open the row ------------------------------
create function public.resource_slug_lookup(p_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.slug
    from public.resource_slug_history h
    join public.resources r on r.id = h.resource_id
   where h.slug = lower(btrim(p_slug))
     and ((r.published = true and lower(coalesce(r.access_level, 'public')) = 'public')
          or (auth.uid() is not null
              and (public.is_moderator()
                   or (r.published = true and public.can_access_resource(r.access_level)))))
   limit 1
$fn$;
comment on function public.resource_slug_lookup(text) is
  'The current address of the article an old address (resource_slug_history) belonged to, when the caller may read that article (the rules of the resources select policies); null otherwise. Used by the article page and the edge function (GET). 20261020160000.';
revoke all on function public.resource_slug_lookup(text) from public;
grant execute on function public.resource_slug_lookup(text) to anon, authenticated, service_role;

create function public.event_slug_lookup(p_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select e.slug
    from public.event_slug_history h
    join public.events e on e.id = h.event_id
   where h.slug = lower(btrim(p_slug))
     and ((e.published is not false and lower(coalesce(e.access_level, 'public')) = 'public')
          or (auth.uid() is not null
              and (public.is_moderator()
                   or (e.published is not false and public.can_access_resource(e.access_level)))))
   limit 1
$fn$;
comment on function public.event_slug_lookup(text) is
  'The current address of the event an old address (event_slug_history) belonged to, when the caller may read that event (the rules of the events select policies) and it is not unpublished (staff excepted); null otherwise. Used by the event page and the edge function (GET). 20261020160000.';
revoke all on function public.event_slug_lookup(text) from public;
grant execute on function public.event_slug_lookup(text) to anon, authenticated, service_role;

-- 6. Backfill, oldest first; updated_at and published_at untouched -----------------------------
alter table public.resources disable trigger trg_resources_updated_at;
alter table public.resources disable trigger trg_resources_stamp_published_at;

do $fill$
declare
  v_id uuid;
begin
  -- The address the site's code links to (src/lib/seoMeta.ts, RENDEZVOUS_6TH_SLUG), set by name:
  -- an explicit address (slug_auto false), so it never follows the title.
  update public.events e
     set slug = 'monaco-smart-and-sustainable-marina-2026-6th-edition'
   where e.id = 'f55f7b2f-96ac-4c5e-b620-358624e52240'::uuid and e.slug is null;
  for v_id in select r.id from public.resources r where r.slug is null
               order by coalesce(r.published_at, r.created_at), r.id loop
    update public.resources r set slug = null where r.id = v_id;
  end loop;
  -- Each event's slug_public is recorded by the same update (published not false).
  for v_id in select e.id from public.events e where e.slug is null
               order by e.created_at, e.id loop
    update public.events e set slug = null where e.id = v_id;
  end loop;
end
$fill$;

alter table public.resources enable trigger trg_resources_stamp_published_at;
alter table public.resources enable trigger trg_resources_updated_at;

alter table public.resources alter column slug set not null;
alter table public.events alter column slug set not null;

-- After: every row has its address, privileges and policies exactly as intended, else the whole
-- file rolls back.
do $post$
begin
  if exists (select 1 from public.resources r where r.slug is null) or exists (select 1 from public.events e where e.slug is null) then
    raise exception 'readable_slugs: a row has no address';
  end if;
  if exists (select 1 from public.events e where e.id = 'f55f7b2f-96ac-4c5e-b620-358624e52240'::uuid
                and (e.slug <> 'monaco-smart-and-sustainable-marina-2026-6th-edition' or e.slug_auto)) then
    raise exception 'readable_slugs: the Rendezvous 6th edition did not get the address the code links to, set by name';
  end if;
  -- Every other address is the automatic one; slug_public says what published says.
  if exists (select 1 from public.resources r where not r.slug_auto)
     or exists (select 1 from public.events e where not e.slug_auto and e.id <> 'f55f7b2f-96ac-4c5e-b620-358624e52240'::uuid)
     or exists (select 1 from public.events e where e.slug_public is distinct from (e.published is not false)) then
    raise exception 'readable_slugs: slug_auto / slug_public not as the backfill should leave them';
  end if;
  if (select count(*) from pg_attribute a
       where a.attnum > 0 and not a.attisdropped and a.attnotnull
         and ((a.attrelid = 'public.resources'::regclass and a.attname in ('slug', 'slug_auto'))
              or (a.attrelid = 'public.events'::regclass and a.attname in ('slug', 'slug_auto', 'slug_public')))) <> 5 then
    raise exception 'readable_slugs: slug / slug_auto / slug_public are not all NOT NULL';
  end if;
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.resources'::regclass
         and t.tgname in ('trg_resources_updated_at', 'trg_resources_stamp_published_at', 'trg_resources_slug_assign', 'trg_resources_slug_remember')
         and t.tgenabled::text = 'O') <> 4
     or (select count(*) from pg_trigger t
          where t.tgrelid = 'public.events'::regclass
            and t.tgname in ('events_slug_assign', 'events_slug_remember')
            and t.tgenabled::text = 'O') <> 2 then
    raise exception 'readable_slugs: a trigger is missing or switched off';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.resource_slug_history'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.event_slug_history'::regclass)
     or has_table_privilege('anon', 'public.resource_slug_history', 'select, insert, update, delete')
     or has_table_privilege('anon', 'public.event_slug_history', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.resource_slug_history', 'insert, update, delete')
     or has_table_privilege('authenticated', 'public.event_slug_history', 'insert, update, delete')
     or not has_table_privilege('authenticated', 'public.resource_slug_history', 'select')
     or not has_table_privilege('authenticated', 'public.event_slug_history', 'select')
     or (select count(*) from pg_policies pl where pl.schemaname = 'public' and pl.tablename in ('resource_slug_history', 'event_slug_history')) <> 2 then
    raise exception 'readable_slugs: wrong privileges, RLS or policies on the history tables';
  end if;
  if not has_function_privilege('anon', 'public.resource_slug_lookup(text)', 'execute')
     or not has_function_privilege('anon', 'public.event_slug_lookup(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.resource_slug_lookup(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.event_slug_lookup(text)', 'execute')
     or has_function_privilege('anon', 'public.smc_slug_assign()', 'execute')
     or has_function_privilege('authenticated', 'public.smc_slug_assign()', 'execute')
     or has_function_privilege('anon', 'public.smc_slug_remember()', 'execute')
     or has_function_privilege('authenticated', 'public.smc_slug_remember()', 'execute') then
    raise exception 'readable_slugs: wrong function privileges';
  end if;
end
$post$;
