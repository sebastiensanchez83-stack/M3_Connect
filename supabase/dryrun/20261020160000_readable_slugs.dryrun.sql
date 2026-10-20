-- DRY RUN of supabase/migrations/20261020160000_readable_slugs.sql and of its down. NOT A
-- MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- A. snapshot (every article and event row, every public function, table, column, constraint,
-- trigger and policy); B. the migration, verbatim; C. checks of the backfill, the rules and the
-- privileges, then cases on throw-away articles and events created inside the run, as the
-- owner, a moderator, a signed-in member and a visitor: the live site's insert and update shapes,
-- collisions, accents, a stable address on a title edit, drafts following their title, an
-- address frozen for good once a row was public (unpublished or hidden later), a hand-picked
-- address never taken for an automatic one, no history for addresses nobody saw, explicit
-- changes, the history and the lookups, row-level security; every write of the cases is rolled
-- back with them; D. the down, verbatim; E. checks after the down. No sm_* row is touched; the
-- output names no article (counts only) and no person.
-- Ends with RAISE EXCEPTION 'DRYRUN ...': everything rolls back. Expected: "49 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Snapshot (S01 after the migration and the cases: nothing that existed changed; E02 after the
-- down: everything exactly as before). The new columns are left out of the row hashes.
create function pg_temp.dr_snap() returns table (k text, v text) language sql as $f$
  select 'res:' || r.id::text, md5((to_jsonb(r) - array['slug', 'slug_auto'])::text) from public.resources r
  union all
  select 'evt:' || e.id::text, md5((to_jsonb(e) - array['slug', 'slug_auto', 'slug_public'])::text) from public.events e
  union all
  select 'fn:' || p.oid::regprocedure::text,
         coalesce(array_to_string(p.proacl, ','), '') || ':' || md5(p.prosrc) || ':' || p.prosecdef::text || ':'
           || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ';'), '')
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'tbl:' || c.oid::regclass::text,
         c.relkind::text || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text || ':' || coalesce(array_to_string(c.relacl, ','), '')
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'i')
  union all
  select 'col:' || c.oid::regclass::text || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(array_to_string(a.attacl, ','), '')
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  union all
  select 'con:' || cn.conrelid::regclass::text || '.' || cn.conname, md5(pg_get_constraintdef(cn.oid))
    from pg_constraint cn where cn.connamespace = 'public'::regnamespace
  union all
  select 'trg:' || t.tgrelid::regclass::text || '.' || t.tgname, t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid))
    from pg_trigger t where not t.tgisinternal
  union all
  select 'pol:' || pl.schemaname || '.' || pl.tablename || '.' || pl.policyname,
         md5(format('%s|%s|%s|%s', pl.cmd, pl.roles, pl.qual, pl.with_check))
    from pg_policies pl
$f$;
create temp table _dr_before on commit drop as select * from pg_temp.dr_snap();
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create function pg_temp.dr_claims(p_uid uuid) returns text language sql stable as $f$
  select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', (select u.email from auth.users u where u.id = p_uid))::text
$f$;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', '', true), set_config('request.jwt.claims', '', true);

-- B. The migration, verbatim ─────────────────────────────────────────────────────
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
-- ─────────────────────────────────────────────────────────────────────────────────

-- C. Checks after the migration (read only)
do $c$
declare
  v_n integer;
  v_n2 integer;
  v_n3 integer;
  v_n4 integer;
  v_txt text;
  v_bad text;
begin
  -- C01 / C02 every row has its own address, in the format
  select count(*), count(r.slug), count(distinct r.slug), count(*) filter (where r.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    into v_n, v_n2, v_n3, v_n4 from public.resources r;
  insert into _dr_res (ok, label) values (v_n > 0 and v_n = v_n2 and v_n2 = v_n3 and v_n4 = 0,
    format('C01 every article has its own address: %s articles, %s addresses, %s distinct, %s badly formed', v_n, v_n2, v_n3, v_n4));
  select count(*), count(e.slug), count(distinct e.slug), count(*) filter (where e.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
    into v_n, v_n2, v_n3, v_n4 from public.events e;
  insert into _dr_res (ok, label) values (v_n > 0 and v_n = v_n2 and v_n2 = v_n3 and v_n4 = 0,
    format('C02 every event has its own address: %s events, %s addresses, %s distinct, %s badly formed', v_n, v_n2, v_n3, v_n4));

  -- C03 each address is its title's (a "-N" only on a collision), at most 80 characters
  select count(*) filter (where not (r.slug = x.b or r.slug ~ ('^' || x.b || '-[0-9]+$'))),
         count(*) filter (where r.slug <> x.b), coalesce(max(length(r.slug)), 0)
    into v_n, v_n2, v_n3
    from public.resources r cross join lateral (select coalesce(nullif(public.smc_slugify(r.title), ''), 'article') as b) as x;
  select count(*) filter (where not (e.slug = x.b or e.slug ~ ('^' || x.b || '-[0-9]+$'))), coalesce(max(length(e.slug)), 0)
    into v_n4, v_txt
    from public.events e cross join lateral (select coalesce(nullif(public.smc_slugify(e.title), ''), 'event') as b) as x;
  insert into _dr_res (ok, label) values (v_n = 0 and v_n4 = 0 and v_n3 <= 80 and v_txt::integer <= 80,
    format('C03 addresses come from the titles: articles not from their title %s (with a suffix %s, longest %s), events not from their title %s (longest %s)',
      v_n, v_n2, v_n3, v_n4, v_txt));

  -- C04 the Rendezvous 6th edition has the address the code links to (src/lib/seoMeta.ts), set by name (not automatic)
  insert into _dr_res (ok, label) values (
    coalesce((select e.slug = 'monaco-smart-and-sustainable-marina-2026-6th-edition' and not e.slug_auto from public.events e
               where e.id = 'f55f7b2f-96ac-4c5e-b620-358624e52240'::uuid), true),
    'C04 Rendezvous 6th edition: ' || coalesce((select e.slug || ', automatic ' || e.slug_auto::text from public.events e
                                                 where e.id = 'f55f7b2f-96ac-4c5e-b620-358624e52240'::uuid), '(no such row)'));

  -- C05 the backfill changed nothing else on any row (updated_at = sitemap lastmod, published_at = RSS date)
  select count(*) into v_n from (
    (select b.k, b.v from _dr_before b where b.k like 'res:%' or b.k like 'evt:%')
    except
    (select a.k, a.v from pg_temp.dr_snap() a where a.k like 'res:%' or a.k like 'evt:%')) as d;
  insert into _dr_res (ok, label) values (v_n = 0,
    format('C05 the backfill touched no other column of any article or event (updated_at, published_at...): %s row(s) differ', v_n));

  -- C06 smc_slugify, case by case (non-ASCII written with chr())
  select string_agg(format('[%s] gave [%s], expected [%s]', t.label, coalesce(public.smc_slugify(t.input), 'NULL'), coalesce(t.expected, 'NULL')), '; ')
    into v_bad
    from (values
      ('accents', chr(199) || 'a ' || chr(233) || 't' || chr(233) || ' ' || chr(8212) || ' ' || chr(338) || 'uvre ' || chr(198) || 'sir' || chr(8217) || 's ' || chr(223), 'ca-ete-oeuvre-aesirs-ss'),
      ('ampersand', 'Marina challenges & opportunities for Startups', 'marina-challenges-and-opportunities-for-startups'),
      ('apostrophe, question mark', 'Europe' || chr(8217) || 's Ocean Economy?', 'europes-ocean-economy'),
      ('emoji only', chr(128512) || chr(128513), ''),
      ('CJK only', chr(28207) || chr(21475), ''),
      ('one 100-letter word', repeat('a', 100), repeat('a', 80)),
      ('word cut', 'alpha ' || repeat('b', 76) || ' gamma', 'alpha'),
      ('cut on a boundary', repeat('c', 80) || ' d', repeat('c', 80)),
      ('spaces and dashes', '  --  Hello   World  -- ', 'hello-world'),
      ('digits', '2026', '2026'),
      ('null', null, null)) as t(label, input, expected)
   where public.smc_slugify(t.input) is distinct from t.expected;
  select count(*) into v_n
    from (values ('Monaco Smart & Sustainable Marina 2026, 6th edition'), ('Europe' || chr(8217) || 's  Ocean -- Economy?'),
                 (repeat('word ', 30)), ('dryrun-already-a-slug')) as t(input)
   where public.smc_slugify(public.smc_slugify(t.input)) is distinct from public.smc_slugify(t.input);
  insert into _dr_res (ok, label) values (v_bad is null and v_n = 0
      and (select p.provolatile::text = 'i' and p.proisstrict from pg_proc p where p.oid = 'public.smc_slugify(text)'::regprocedure),
    'C06 smc_slugify: accents, ligatures, &, apostrophes, emoji, CJK, 80-character word cut; idempotent; immutable and strict: '
      || coalesce(v_bad, 'all as expected') || ', not idempotent: ' || v_n);

  -- C07 shape of the functions
  insert into _dr_res (ok, label) values (
    (select bool_and(p.prosecdef and array_to_string(p.proconfig, ';') = 'search_path=""'
                     and p.provolatile::text = case when p.proname like '%lookup' then 's' else 'v' end)
       from pg_proc p
      where p.oid in ('public.smc_slug_assign()'::regprocedure, 'public.smc_slug_remember()'::regprocedure,
                      'public.resource_slug_lookup(text)'::regprocedure, 'public.event_slug_lookup(text)'::regprocedure))
      and (select position('pg_advisory_xact_lock' in p.prosrc) > 0 from pg_proc p where p.oid = 'public.smc_slug_assign()'::regprocedure),
    'C07 triggers and lookups: SECURITY DEFINER, search_path empty; lookups STABLE (GET from the edge), triggers VOLATILE; assignments serialised by an advisory lock');

  -- C08 who may call what
  insert into _dr_res (ok, label) values (
    has_function_privilege('anon', 'public.resource_slug_lookup(text)', 'execute')
      and has_function_privilege('anon', 'public.event_slug_lookup(text)', 'execute')
      and has_function_privilege('authenticated', 'public.resource_slug_lookup(text)', 'execute')
      and has_function_privilege('authenticated', 'public.event_slug_lookup(text)', 'execute')
      and not has_function_privilege('anon', 'public.smc_slug_assign()', 'execute')
      and not has_function_privilege('authenticated', 'public.smc_slug_assign()', 'execute')
      and not has_function_privilege('anon', 'public.smc_slug_remember()', 'execute')
      and not has_function_privilege('authenticated', 'public.smc_slug_remember()', 'execute')
      and not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                       where p.oid in ('public.smc_slug_assign()'::regprocedure, 'public.smc_slug_remember()'::regprocedure,
                                       'public.resource_slug_lookup(text)'::regprocedure, 'public.event_slug_lookup(text)'::regprocedure,
                                       'public.smc_slugify(text)'::regprocedure)
                         and a.grantee = 0)
      and not exists (select 1 from pg_proc p where p.proacl is null
                         and p.oid in ('public.smc_slug_assign()'::regprocedure, 'public.smc_slug_remember()'::regprocedure,
                                       'public.resource_slug_lookup(text)'::regprocedure, 'public.event_slug_lookup(text)'::regprocedure,
                                       'public.smc_slugify(text)'::regprocedure)),
    'C08 lookups: EXECUTE for anon and authenticated; trigger functions: neither; nothing for PUBLIC');

  -- C09 the history tables: RLS on, one staff-only read policy each, visitors no privilege at all, members select only
  insert into _dr_res (ok, label) values (
    (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.resource_slug_history'::regclass, 'public.event_slug_history'::regclass))
      and not has_table_privilege('anon', 'public.resource_slug_history', 'select, insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('anon', 'public.event_slug_history', 'select, insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('authenticated', 'public.resource_slug_history', 'insert, update, delete, truncate, references, trigger')
      and not has_table_privilege('authenticated', 'public.event_slug_history', 'insert, update, delete, truncate, references, trigger')
      and has_table_privilege('authenticated', 'public.resource_slug_history', 'select')
      and (select count(*) from pg_policies pl where pl.schemaname = 'public' and pl.tablename in ('resource_slug_history', 'event_slug_history')
              and pl.cmd = 'SELECT' and pl.roles::text = '{authenticated}' and pl.qual like '%is_moderator()%') = 2
      and (select count(*) from pg_policies pl where pl.schemaname = 'public' and pl.tablename in ('resource_slug_history', 'event_slug_history')) = 2,
    'C09 history tables: RLS on, staff-only read, no visitor privilege, no member write');

  -- C10 triggers in place and on (the two switched off for the backfill on again)
  select count(*) into v_n from pg_trigger t
   where t.tgenabled::text = 'O'
     and ((t.tgrelid = 'public.resources'::regclass and t.tgname in ('trg_resources_slug_assign', 'trg_resources_slug_remember',
                                                                      'trg_resources_updated_at', 'trg_resources_stamp_published_at'))
          or (t.tgrelid = 'public.events'::regclass and t.tgname in ('events_slug_assign', 'events_slug_remember')));
  insert into _dr_res (ok, label) values (v_n = 6,
    format('C10 triggers on: 4 new, and trg_resources_updated_at and trg_resources_stamp_published_at on again (%s of 6)', v_n));

  -- C11 the columns: NOT NULL, unique, format; the history empty after the backfill
  select count(*) into v_n from pg_attribute a
   where a.attnum > 0 and not a.attisdropped and a.attnotnull
     and ((a.attrelid = 'public.resources'::regclass and a.attname in ('slug', 'slug_auto'))
          or (a.attrelid = 'public.events'::regclass and a.attname in ('slug', 'slug_auto', 'slug_public')));
  insert into _dr_res (ok, label) values (
    v_n = 5
      and (select count(*) from pg_constraint cn
            where cn.conrelid in ('public.resources'::regclass, 'public.events'::regclass)
              and cn.conname in ('resources_slug_key', 'resources_slug_format', 'events_slug_key', 'events_slug_format')) = 4
      and not exists (select 1 from public.resource_slug_history) and not exists (select 1 from public.event_slug_history),
    format('C11 slug, slug_auto (both) and slug_public (events) NOT NULL (%s of 5); slug unique and format-checked on both tables; no old address recorded by the backfill', v_n));

  -- C12 the flags after the backfill: every address automatic but the Rendezvous'; slug_public = published not false
  select count(*) filter (where not r.slug_auto) into v_n from public.resources r;
  select count(*) filter (where not e.slug_auto and e.id <> 'f55f7b2f-96ac-4c5e-b620-358624e52240'::uuid),
         count(*) filter (where e.slug_public is distinct from (e.published is not false)),
         count(*) filter (where e.slug_public)
    into v_n2, v_n3, v_n4 from public.events e;
  insert into _dr_res (ok, label) values (v_n = 0 and v_n2 = 0 and v_n3 = 0,
    format('C12 after the backfill: automatic addresses (set by hand: articles %s, events other than the Rendezvous %s); slug_public as published for every event (%s differ, %s public)',
      v_n, v_n2, v_n3, v_n4));

  -- C13 the assign triggers fire on the flags too, so whatever a client writes there is put back
  insert into _dr_res (ok, label) values (
    coalesce((select position('BEFORE INSERT OR UPDATE OF slug, title, slug_auto ON ' in pg_get_triggerdef(t.oid)) > 0
                from pg_trigger t where t.tgrelid = 'public.resources'::regclass and t.tgname = 'trg_resources_slug_assign'), false)
      and coalesce((select position('BEFORE INSERT OR UPDATE OF slug, title, slug_auto, published, slug_public ON ' in pg_get_triggerdef(t.oid)) > 0
                     from pg_trigger t where t.tgrelid = 'public.events'::regclass and t.tgname = 'events_slug_assign'), false),
    'C13 the assign triggers fire on slug, title and slug_auto (events: and published, slug_public)');
end
$c$;

-- C (continued). Cases, all inside one block that rolls back at its end; the results survive in arrays.
do $cases$
declare
  v_mod uuid; v_mem uuid; v_pub uuid; v_pub_slug text;
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_acc uuid; v_emo uuid; v_uid uuid; v_draft uuid; v_manual uuid;
  v_new uuid; v_hidden uuid; v_mres uuid;
  v_ev_live uuid; v_ev_core uuid; v_ev_hidden uuid;
  v_wp uuid; v_aw uuid; v_bs uuid; v_bs2 uuid; v_ev_shown uuid; v_ev_aw uuid;
  v_id uuid;
  v_st text; v_st2 text;
  v_s text; v_s2 text; v_s3 text; v_s4 text;
  v_n integer; v_n2 integer; v_n3 integer; v_n4 integer;
  v_b boolean; v_b2 boolean; v_b3 boolean;
  r_ok boolean[] := '{}';
  r_lb text[] := '{}';
begin
  begin
    -- F00 fixtures: a verified moderator, a verified member who is neither staff nor a marina, a
    -- published public article.
    select p.user_id into v_mod from public.profiles p join auth.users u on u.id = p.user_id
     where p.access_status = 'verified' and p.persona::text in ('admin', 'moderator') order by p.user_id limit 1;
    select p.user_id into v_mem from public.profiles p join auth.users u on u.id = p.user_id
     where p.access_status = 'verified' and p.persona::text not in ('admin', 'moderator', 'marina') order by p.user_id limit 1;
    select r.id, r.slug into v_pub, v_pub_slug from public.resources r
     where r.published = true and lower(coalesce(r.access_level, 'public')) = 'public' order by r.id limit 1;
    r_ok := r_ok || (v_mod is not null and v_mem is not null and v_pub is not null);
    r_lb := r_lb || format('F00 fixtures: moderator %s, member %s, public article %s', v_mod is not null, v_mem is not null, v_pub is not null);

    -- L01 the live site's article insert (AdminResourceDetail payload, no slug), as a moderator through RLS
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      insert into public.resources (title, summary, content, type, topic, language, access_level, thumbnail_url, file_url,
                                    seo_keywords, published, share_to_m3, share_to_s3)
      values ('DRYRUN Slug check ' || chr(8212) || ' article', 'dry run', '<p>dry run</p>', 'article', 'dryrun', 'EN', 'public',
              null, null, null, true, false, false)
      returning id, slug, slug_auto into v_a1, v_s, v_b;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_s = 'dryrun-slug-check-article' and v_b is true);
    r_lb := r_lb || format('L01 the live site''s article insert (no slug) as a moderator gets its address from the title: %s, %s, automatic %s',
      v_st, coalesce(v_s, 'NULL'), v_b);

    -- L02 the same title twice more: -2, -3, never an error
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      insert into public.resources (title, summary, type, published, access_level)
      values ('DRYRUN Slug check ' || chr(8212) || ' article', 'dry run', 'article', true, 'public') returning id, slug into v_a2, v_s2;
      insert into public.resources (title, summary, type, published, access_level)
      values ('DRYRUN slug CHECK article', 'dry run', 'article', true, 'public') returning id, slug into v_a3, v_s3;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_s2 = 'dryrun-slug-check-article-2' and v_s3 = 'dryrun-slug-check-article-3');
    r_lb := r_lb || format('L02 two more articles with the same title get -2 and -3: %s, %s, %s', v_st, v_s2, v_s3);

    -- L03 accents and ligatures; L04 a title of emoji only; L05 a title shaped like an id (inserted by the owner)
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN ' || chr(201) || 't' || chr(233) || ' ' || chr(224) || ' Monaco : l' || chr(8217) || chr(339) || 'uvre & co', 'dry run', 'article', true, 'public')
    returning id, slug into v_acc, v_s;
    r_ok := r_ok || (v_s = 'dryrun-ete-a-monaco-loeuvre-and-co');
    r_lb := r_lb || ('L03 accents, ligature, apostrophe and & in a title: ' || v_s);
    insert into public.resources (title, summary, type, published, access_level)
    values (chr(128674) || chr(9875), 'dry run', 'article', false, 'public') returning id, slug into v_emo, v_s;
    r_ok := r_ok || (v_s ~ '^article(-[0-9]+)?$');
    r_lb := r_lb || ('L04 a title of emoji only gets the fallback "article": ' || v_s);
    v_id := gen_random_uuid();
    insert into public.resources (title, summary, type, published, access_level)
    values (upper(v_id::text), 'dry run', 'article', false, 'public') returning id, slug into v_uid, v_s;
    r_ok := r_ok || (v_s = 'article-' || v_id::text);
    r_lb := r_lb || ('L05 a title shaped like an id never gives an id-shaped address: ' || case when v_s = 'article-' || v_id::text then 'article-<uuid>' else v_s end);

    -- L06 the live site's update of a published article (AdminResourceDetail payload, new title): the address stays
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      update public.resources
         set title = 'DRYRUN Slug check renamed', summary = 'dry run 2', content = '<p>dry run 2</p>', type = 'article', topic = 'dryrun',
             language = 'EN', access_level = 'public', thumbnail_url = null, file_url = null, seo_keywords = null, published = true,
             share_to_m3 = false, share_to_s3 = false
       where id = v_a1;
      get diagnostics v_n = row_count;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select r.slug, r.slug_auto into v_s, v_b from public.resources r where r.id = v_a1;
    select count(*) into v_n2 from public.resource_slug_history h where h.resource_id = v_a1;
    r_ok := r_ok || (v_st = 'ok' and v_n = 1 and v_s = 'dryrun-slug-check-article' and v_b is true and v_n2 = 0);
    r_lb := r_lb || format('L06 the live site''s update of a published article with a new title keeps its address: %s, %s row, %s (automatic %s), history %s',
      v_st, v_n, v_s, v_b, v_n2);

    -- L07 a draft follows its title until it is published, then never again; the addresses it had as a
    -- draft are not kept (nobody saw them)
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN Draft first title', 'dry run', 'article', false, 'public') returning id, slug into v_draft, v_s;
    update public.resources set title = 'DRYRUN Draft second title' where id = v_draft;
    select r.slug into v_s2 from public.resources r where r.id = v_draft;
    update public.resources set title = 'DRYRUN Draft final title', published = true where id = v_draft;
    select r.slug into v_s3 from public.resources r where r.id = v_draft;
    update public.resources set title = 'DRYRUN Draft retitled after publication' where id = v_draft;
    select r.slug into v_s4 from public.resources r where r.id = v_draft;
    select string_agg(h.slug, ',' order by h.slug) into v_st from public.resource_slug_history h where h.resource_id = v_draft;
    r_ok := r_ok || (v_s = 'dryrun-draft-first-title' and v_s2 = 'dryrun-draft-second-title' and v_s3 = 'dryrun-draft-final-title'
                     and v_s4 = 'dryrun-draft-final-title' and coalesce(v_st, '') = '');
    r_lb := r_lb || format('L07 a draft follows its title (%s -> %s -> %s at publication), then keeps it (%s); draft addresses kept: %s',
      v_s, v_s2, v_s3, v_s4, coalesce(v_st, 'none'));

    -- L08 a moderator chooses an address: normalised, set by hand, the old one kept (the article was public)
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      update public.resources set slug = 'DRYRUN Custom  Address!' where id = v_a1;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select r.slug, r.slug_auto into v_s, v_b from public.resources r where r.id = v_a1;
    select string_agg(h.slug, ',' order by h.slug) into v_s2 from public.resource_slug_history h where h.resource_id = v_a1;
    r_ok := r_ok || (v_st = 'ok' and v_s = 'dryrun-custom-address' and v_b is false and v_s2 = 'dryrun-slug-check-article');
    r_lb := r_lb || format('L08 a moderator sets an address by hand (normalised, automatic %s); the old one kept: %s, %s, history %s', v_b, v_st, v_s, v_s2);

    -- L09 an address another article has now is refused (checked after the expected error)
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      update public.resources set slug = 'dryrun-slug-check-article-2' where id = v_a1;
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select r.slug into v_s from public.resources r where r.id = v_a1;
    r_ok := r_ok || (v_st like '23505 slug_taken%' and v_s = 'dryrun-custom-address');
    r_lb := r_lb || format('L09 another article''s current address is refused: %s; still %s', v_st, v_s);

    -- L10 an address another article had before is refused too (it keeps redirecting there)
    begin
      update public.resources set slug = 'dryrun-slug-check-article' where id = v_a2;
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    select r.slug into v_s from public.resources r where r.id = v_a2;
    r_ok := r_ok || (v_st like '23505 slug_taken%' and v_s = 'dryrun-slug-check-article-2');
    r_lb := r_lb || format('L10 another article''s old address is refused: %s; still %s', v_st, v_s);

    -- L11 an address with no letter or digit, or shaped like an id, is refused
    begin
      update public.resources set slug = chr(128512) || ' !' where id = v_a2;
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    begin
      update public.resources set slug = gen_random_uuid()::text where id = v_a2;
      v_st2 := 'no error';
    exception when others then v_st2 := sqlstate || ' ' || sqlerrm;
    end;
    select r.slug into v_s from public.resources r where r.id = v_a2;
    r_ok := r_ok || (v_st like '22023 slug_invalid%' and v_st2 like '22023 slug_invalid%' and v_s = 'dryrun-slug-check-article-2');
    r_lb := r_lb || format('L11 an empty or id-shaped address is refused: %s / %s; still %s', v_st, v_st2, v_s);

    -- L12 an article takes back one of its own old addresses: allowed, the history follows
    update public.resources set slug = 'dryrun-slug-check-article' where id = v_a1;
    select r.slug into v_s from public.resources r where r.id = v_a1;
    select string_agg(h.slug, ',' order by h.slug) into v_s2 from public.resource_slug_history h where h.resource_id = v_a1;
    r_ok := r_ok || (v_s = 'dryrun-slug-check-article' and v_s2 = 'dryrun-custom-address');
    r_lb := r_lb || format('L12 an article takes back its own old address: %s, history %s', v_s, v_s2);

    -- L13 an address chosen by hand on a draft survives a title edit
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN Manual one', 'dry run', 'article', false, 'public') returning id into v_manual;
    update public.resources set slug = 'dryrun-handpicked' where id = v_manual;
    update public.resources set title = 'DRYRUN Manual two' where id = v_manual;
    select r.slug into v_s from public.resources r where r.id = v_manual;
    r_ok := r_ok || (v_s = 'dryrun-handpicked');
    r_lb := r_lb || ('L13 a hand-picked address on a draft survives a title edit: ' || v_s);

    -- L14 clearing the address (null) gives a fresh one from the title; the old one kept (the article was public)
    update public.resources set title = 'DRYRUN Fresh title', slug = null where id = v_a3;
    select r.slug into v_s from public.resources r where r.id = v_a3;
    select string_agg(h.slug, ',' order by h.slug) into v_s2 from public.resource_slug_history h where h.resource_id = v_a3;
    r_ok := r_ok || (v_s = 'dryrun-fresh-title' and v_s2 = 'dryrun-slug-check-article-3');
    r_lb := r_lb || format('L14 a cleared address is made again from the title: %s, history %s', v_s, v_s2);

    -- L15 publish_resource_from_draft's upsert, as a moderator: an existing article keeps its
    -- address; a new one gets one from its title
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      insert into public.resources (id, title, summary, content, type, topic, language, access_level,
                                    thumbnail_url, file_url, published, created_at, updated_at, published_at, published_by, tags)
      values (v_a1, 'DRYRUN Draft republished', 'dry run', '<p>dry run</p>', 'article', 'dryrun', 'EN', 'public',
              null, null, true, now(), now(), now(), null, '{}'::text[])
      on conflict (id) do update set
        title = excluded.title, summary = excluded.summary, content = excluded.content,
        type = excluded.type, topic = excluded.topic, language = excluded.language,
        access_level = excluded.access_level, thumbnail_url = excluded.thumbnail_url,
        file_url = excluded.file_url, published = true, updated_at = now(),
        published_at = now(), published_by = excluded.published_by;
      v_new := gen_random_uuid();
      insert into public.resources (id, title, summary, content, type, topic, language, access_level,
                                    thumbnail_url, file_url, published, created_at, updated_at, published_at, published_by, tags)
      values (v_new, 'DRYRUN Brand new from a draft', 'dry run', '<p>dry run</p>', 'article', 'dryrun', 'EN', 'public',
              null, null, true, now(), now(), now(), null, '{}'::text[])
      on conflict (id) do update set title = excluded.title;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select r.slug into v_s from public.resources r where r.id = v_a1;
    select r.slug into v_s2 from public.resources r where r.id = v_new;
    r_ok := r_ok || (v_st = 'ok' and v_s = 'dryrun-slug-check-article' and v_s2 = 'dryrun-brand-new-from-a-draft');
    r_lb := r_lb || format('L15 the draft-publishing upsert: existing article keeps %s, new one gets %s (%s)', v_s, v_s2, v_st);

    -- L16 the live site's event insert (AdminEventDetail payload), as a moderator through RLS
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      insert into public.events (title, description, date_time, end_date_time, location, language, access_level, speakers,
                                 replay_url, meeting_url, event_type, invitation_only, is_full_day, published, pdf_url, image_url)
      values ('DRYRUN Event live shape', 'dry run', now() + interval '400 days', null, null, 'EN', 'public', '[]'::jsonb,
              null, null, 'webinar', false, false, true, null, null)
      returning id, slug, slug_public into v_ev_live, v_s, v_b;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_s = 'dryrun-event-live-shape' and v_b is true);
    r_lb := r_lb || format('L16 the live site''s event insert (no slug) as a moderator: %s, %s, public %s', v_st, coalesce(v_s, 'NULL'), v_b);

    -- L17 admin_save_event's shape (insert unpublished, then update): the address follows the title
    -- up to publication, then stays; the addresses it had unpublished are not kept
    insert into public.events (title, event_type, invitation_only, access_level, published, meeting_url)
    values ('DRYRUN Core event (copy)', 'on_site', false, 'public', false, null) returning id, slug, slug_public into v_ev_core, v_s, v_b;
    update public.events e set title = 'DRYRUN Core event 2027', published = false, meeting_url = null where e.id = v_ev_core;
    select e.slug into v_s2 from public.events e where e.id = v_ev_core;
    update public.events e set title = 'DRYRUN Core event final', published = true, meeting_url = null where e.id = v_ev_core;
    select e.slug, e.slug_public into v_s3, v_b2 from public.events e where e.id = v_ev_core;
    update public.events e set title = 'DRYRUN Core event renamed', published = true, meeting_url = null where e.id = v_ev_core;
    select e.slug into v_s4 from public.events e where e.id = v_ev_core;
    select string_agg(h.slug, ',' order by h.slug) into v_st from public.event_slug_history h where h.event_id = v_ev_core;
    r_ok := r_ok || (v_s = 'dryrun-core-event-copy' and v_s2 = 'dryrun-core-event-2027' and v_s3 = 'dryrun-core-event-final'
                     and v_s4 = 'dryrun-core-event-final' and coalesce(v_st, '') = '' and v_b is false and v_b2 is true);
    r_lb := r_lb || format('L17 an event saved like admin_save_event: %s -> %s -> %s at publication (public %s -> %s), then kept (%s); unpublished addresses kept: %s',
      v_s, v_s2, v_s3, v_b, v_b2, v_s4, coalesce(v_st, 'none'));

    -- Old addresses for the lookups: an article published then unpublished, a members-only
    -- article, an event shown then hidden, a public event; each address changed by hand after.
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN Hidden first', 'dry run', 'article', true, 'public') returning id into v_hidden;
    update public.resources set published = false where id = v_hidden;
    update public.resources set slug = 'dryrun-hidden-second' where id = v_hidden;
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN Members first', 'dry run', 'article', true, 'members') returning id into v_mres;
    update public.resources set slug = 'dryrun-members-second' where id = v_mres;
    insert into public.events (title, event_type, published, access_level)
    values ('DRYRUN Hidden event one', 'webinar', true, 'public') returning id into v_ev_hidden;
    update public.events e set published = false where e.id = v_ev_hidden;
    update public.events e set slug = 'dryrun-hidden-event-two' where e.id = v_ev_hidden;
    update public.events e set slug = 'dryrun-event-live-new' where e.id = v_ev_live;

    -- L18 a visitor follows the old address of a public article (case and spaces ignored); unknown -> null
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      v_s := public.resource_slug_lookup('dryrun-custom-address');
      v_s2 := public.resource_slug_lookup('  DRYRUN-Custom-Address ');
      v_s3 := public.resource_slug_lookup('dryrun-no-such-address');
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_s = 'dryrun-slug-check-article' and v_s2 = 'dryrun-slug-check-article' and v_s3 is null);
    r_lb := r_lb || format('L18 a visitor: old address of a public article -> %s (%s), unknown -> %s (%s)', v_s, v_s2, coalesce(v_s3, 'NULL'), v_st);

    -- L19 the old address of an unpublished article: nothing for a visitor or a member, the current one for staff
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      v_s := public.resource_slug_lookup('dryrun-hidden-first');
      reset role;
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mem), true);
      set local role authenticated;
      v_s2 := public.resource_slug_lookup('dryrun-hidden-first');
      reset role;
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      v_s3 := public.resource_slug_lookup('dryrun-hidden-first');
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_s is null and v_s2 is null and v_s3 = 'dryrun-hidden-second');
    r_lb := r_lb || format('L19 old address of an unpublished article: visitor %s, member %s, moderator %s (%s)',
      coalesce(v_s, 'NULL'), coalesce(v_s2, 'NULL'), coalesce(v_s3, 'NULL'), v_st);

    -- L20 the old address of a members-only article: nothing for a visitor; for a member exactly when
    -- they may read members' articles (can_access_resource)
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      v_s := public.resource_slug_lookup('dryrun-members-first');
      reset role;
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mem), true);
      set local role authenticated;
      v_b := public.can_access_resource('members');
      v_s2 := public.resource_slug_lookup('dryrun-members-first');
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_s is null and v_s2 is not distinct from case when v_b then 'dryrun-members-second' end);
    r_lb := r_lb || format('L20 old address of a members-only article: visitor %s, member %s (may read members'' articles: %s) (%s)',
      coalesce(v_s, 'NULL'), coalesce(v_s2, 'NULL'), v_b, v_st);

    -- L21 events: the old address of an unpublished event leads nowhere except for staff; a public one for everyone
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      v_s := public.event_slug_lookup('dryrun-hidden-event-one');
      v_s4 := public.event_slug_lookup('dryrun-event-live-shape');
      reset role;
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mem), true);
      set local role authenticated;
      v_s2 := public.event_slug_lookup('dryrun-hidden-event-one');
      reset role;
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      v_s3 := public.event_slug_lookup('dryrun-hidden-event-one');
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_s is null and v_s2 is null and v_s3 = 'dryrun-hidden-event-two' and v_s4 = 'dryrun-event-live-new');
    r_lb := r_lb || format('L21 events: unpublished event''s old address: visitor %s, member %s, moderator %s; public event''s: visitor %s (%s)',
      coalesce(v_s, 'NULL'), coalesce(v_s2, 'NULL'), coalesce(v_s3, 'NULL'), coalesce(v_s4, 'NULL'), v_st);

    -- L22 a visitor cannot read the history tables at all
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      perform h.slug from public.resource_slug_history h;
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      perform h.slug from public.event_slug_history h;
      v_st2 := 'no error';
    exception when others then v_st2 := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st like '42501 permission denied for table%' and v_st2 like '42501 permission denied for table%');
    r_lb := r_lb || ('L22 a visitor cannot read the old addresses: ' || v_st || ' / ' || v_st2);

    -- L23 a member reads none of them; a moderator reads them (articles: v_a1 1, v_a3 1, v_draft 0
    -- (never public before), v_hidden 1, v_mres 1; events: v_ev_live 1, v_ev_core 0, v_ev_hidden 1)
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mem), true);
      set local role authenticated;
      select count(*) into v_n from (select h.slug from public.resource_slug_history h) as x;
      select count(*) into v_n2 from (select h.slug from public.event_slug_history h) as x;
      reset role;
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      select count(*) into v_n3 from (select h.slug from public.resource_slug_history h where h.resource_id in (v_a1, v_a3, v_draft, v_hidden, v_mres)) as x;
      select count(*) into v_n4 from (select h.slug from public.event_slug_history h where h.event_id in (v_ev_live, v_ev_core, v_ev_hidden)) as x;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_n = 0 and v_n2 = 0 and v_n3 = 4 and v_n4 = 2);
    r_lb := r_lb || format('L23 old addresses: a member reads %s / %s; a moderator reads the 4 of the test articles (%s) and the 2 of the test events (%s) (%s)',
      v_n, v_n2, v_n3, v_n4, v_st);

    -- L24 nobody writes the history by hand, not even staff; a member cannot change an address
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      insert into public.resource_slug_history (slug, resource_id) values ('dryrun-forged', v_pub);
      v_st := 'no error';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mem), true);
      set local role authenticated;
      update public.resources set slug = 'dryrun-member-made' where id = v_pub;
      get diagnostics v_n = row_count;
      v_st2 := 'ok';
    exception when others then v_st2 := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select r.slug into v_s from public.resources r where r.id = v_pub;
    r_ok := r_ok || (v_st like '42501 permission denied for table%' and v_st2 = 'ok' and v_n = 0 and v_s = v_pub_slug);
    r_lb := r_lb || format('L24 a moderator cannot write an old address by hand (%s); a member changes no address (%s, %s row)', v_st, v_st2, v_n);

    -- L25 a visitor reads a public article's address (the edge function's and the sitemap's
    -- query) but cannot find an unpublished one through it
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      select r.slug into v_s from public.resources r where r.id = v_pub;
      select count(*) into v_n from (select r.id from public.resources r where r.slug = 'dryrun-hidden-second') as x;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_s = v_pub_slug and v_n = 0);
    r_lb := r_lb || format('L25 a visitor reads a public article''s address (%s) and finds no unpublished article by its address (%s rows) (%s)',
      v_s = v_pub_slug, v_n, v_st);

    -- L26 saving again what is there (the redesign editor sends the slug it loaded) changes nothing;
    -- the backfill run again finds nothing to do
    select r.slug, r.title, r.slug_auto into v_s, v_s2, v_b from public.resources r where r.id = v_pub;
    update public.resources r set slug = v_s, title = v_s2 where r.id = v_pub;
    select count(*) into v_n from public.resource_slug_history h where h.resource_id = v_pub;
    v_n2 := 0;
    for v_id in select r.id from public.resources r where r.slug is null loop
      v_n2 := v_n2 + 1;
    end loop;
    for v_id in select e.id from public.events e where e.slug is null loop
      v_n2 := v_n2 + 1;
    end loop;
    r_ok := r_ok || ((select r.slug = v_pub_slug and r.slug_auto is not distinct from v_b from public.resources r where r.id = v_pub)
                     and v_n = 0 and v_n2 = 0);
    r_lb := r_lb || format('L26 the same values saved again change nothing (history %s); the backfill would find %s row(s) to do', v_n, v_n2);

    -- L27 deleting an article removes its old addresses
    delete from public.resources r where r.id = v_a1;
    select count(*) into v_n from public.resource_slug_history h where h.resource_id = v_a1;
    r_ok := r_ok || (v_n = 0);
    r_lb := r_lb || ('L27 deleting an article deletes its old addresses: left ' || v_n);

    -- L28 an article that was public keeps its address after it is unpublished: the live site's save
    -- (same title, published false, as a moderator), then a new title while unpublished
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN Was public', 'dry run', 'article', true, 'public') returning id, slug into v_wp, v_s;
    begin
      perform set_config('request.jwt.claims', pg_temp.dr_claims(v_mod), true);
      set local role authenticated;
      update public.resources set title = 'DRYRUN Was public', published = false where id = v_wp;
      update public.resources set title = 'DRYRUN Was public renamed', published = false where id = v_wp;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    select r.slug, r.published, r.published_at is not null into v_s2, v_b, v_b2 from public.resources r where r.id = v_wp;
    select count(*) into v_n from public.resource_slug_history h where h.resource_id = v_wp;
    r_ok := r_ok || (v_st = 'ok' and v_s = 'dryrun-was-public' and v_s2 = 'dryrun-was-public' and v_b is false and v_b2 is true and v_n = 0);
    r_lb := r_lb || format('L28 an article published, unpublished, then retitled keeps its address: %s -> %s (published %s, published_at kept %s, history %s) (%s)',
      v_s, v_s2, v_b, v_b2, v_n, v_st);

    -- L29 the same for an event: created unpublished (admin_save_event), published by a publish-only
    -- save, hidden (published false, same title), a client resetting slug_public, then a new title
    insert into public.events (title, event_type, invitation_only, access_level, published, meeting_url)
    values ('DRYRUN Shown event', 'webinar', false, 'public', false, null) returning id, slug, slug_public into v_ev_shown, v_s, v_b;
    update public.events e set published = true where e.id = v_ev_shown;
    select e.slug_public into v_b2 from public.events e where e.id = v_ev_shown;
    update public.events e set title = 'DRYRUN Shown event', published = false, meeting_url = null where e.id = v_ev_shown;
    update public.events e set slug_public = false where e.id = v_ev_shown;
    update public.events e set title = 'DRYRUN Shown event renamed', published = false, meeting_url = null where e.id = v_ev_shown;
    select e.slug, e.slug_public into v_s2, v_b3 from public.events e where e.id = v_ev_shown;
    select count(*) into v_n from public.event_slug_history h where h.event_id = v_ev_shown;
    r_ok := r_ok || (v_s = 'dryrun-shown-event' and v_b is false and v_b2 is true and v_s2 = 'dryrun-shown-event' and v_b3 is true and v_n = 0);
    r_lb := r_lb || format('L29 an event published (public %s -> %s), hidden, then retitled keeps its address: %s -> %s (public %s after a client wrote false; history %s)',
      v_b, v_b2, v_s, v_s2, v_b3, v_n);

    -- L30 a hand-picked address ending in digits is never taken for an automatic one: a draft
    -- "DRYRUN Awards" given "dryrun-awards-2026" keeps it through a title edit (and a client
    -- writing slug_auto true changes nothing); the same for an unpublished event
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN Awards', 'dry run', 'article', false, 'public') returning id, slug into v_aw, v_s;
    update public.resources set slug = 'dryrun-awards-2026' where id = v_aw;
    update public.resources set slug_auto = true where id = v_aw;
    update public.resources set title = 'DRYRUN Awards the winners' where id = v_aw;
    select r.slug, r.slug_auto into v_s2, v_b from public.resources r where r.id = v_aw;
    select count(*) into v_n from public.resource_slug_history h where h.resource_id = v_aw;
    insert into public.events (title, event_type, invitation_only, access_level, published, meeting_url)
    values ('DRYRUN Summit', 'on_site', false, 'public', false, null) returning id into v_ev_aw;
    update public.events e set slug = 'dryrun-summit-2027' where e.id = v_ev_aw;
    update public.events e set title = 'DRYRUN Summit programme', published = false, meeting_url = null where e.id = v_ev_aw;
    select e.slug, e.slug_auto into v_s3, v_b2 from public.events e where e.id = v_ev_aw;
    r_ok := r_ok || (v_s = 'dryrun-awards' and v_s2 = 'dryrun-awards-2026' and v_b is false and v_n = 0
                     and v_s3 = 'dryrun-summit-2027' and v_b2 is false);
    r_lb := r_lb || format('L30 a hand-picked address ending in digits survives a title edit: article %s -> %s (automatic %s, history %s), event %s (automatic %s)',
      v_s, v_s2, v_b, v_n, v_s3, v_b2);

    -- L31 an address only a draft had is not kept: "DRYRUN Boat show" renamed before publication;
    -- a later article of that title gets the bare address, and the old one leads nowhere
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN Boat show', 'dry run', 'article', false, 'public') returning id into v_bs;
    update public.resources set title = 'DRYRUN Boat show our stand' where id = v_bs;
    update public.resources set published = true where id = v_bs;
    select r.slug into v_s from public.resources r where r.id = v_bs;
    select count(*) into v_n from public.resource_slug_history h where h.resource_id = v_bs;
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN Boat show', 'dry run', 'article', true, 'public') returning id, slug into v_bs2, v_s2;
    begin
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      set local role anon;
      v_s3 := public.resource_slug_lookup('dryrun-boat-show');
      select count(*) into v_n2 from (select r.id from public.resources r where r.slug = 'dryrun-boat-show' and r.id = v_bs2) as x;
      v_st := 'ok';
    exception when others then v_st := sqlstate || ' ' || sqlerrm; v_n2 := -1;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    r_ok := r_ok || (v_st = 'ok' and v_s = 'dryrun-boat-show-our-stand' and v_n = 0 and v_s2 = 'dryrun-boat-show' and v_s3 is null and v_n2 = 1);
    r_lb := r_lb || format('L31 a draft''s first address is not kept (%s, history %s): a later article gets %s, the lookup gives %s, a visitor opens it (%s row) (%s)',
      v_s, v_n, v_s2, coalesce(v_s3, 'NULL'), v_n2, v_st);

    -- L32 an address changed by hand before publication is freed too ("dryrun-manual-one", L13), and
    -- clearing a hand-picked address ('') makes it automatic again, from the title
    select count(*) into v_n from public.resource_slug_history h where h.resource_id = v_manual;
    insert into public.resources (title, summary, type, published, access_level)
    values ('DRYRUN Manual one', 'dry run', 'article', true, 'public') returning slug into v_s;
    update public.resources set slug = '' where id = v_manual;
    select r.slug, r.slug_auto into v_s2, v_b from public.resources r where r.id = v_manual;
    select count(*) into v_n2 from public.resource_slug_history h where h.resource_id = v_manual;
    r_ok := r_ok || (v_n = 0 and v_s = 'dryrun-manual-one' and v_s2 = 'dryrun-manual-two' and v_b is true and v_n2 = 0);
    r_lb := r_lb || format('L32 a draft''s hand-changed address is freed (history %s, a new article takes %s); cleared, it is automatic again: %s (automatic %s, history %s)',
      v_n, v_s, v_s2, v_b, v_n2);

    raise exception using errcode = 'DRY01';
  exception when sqlstate 'DRY01' then null;
  end;
  insert into _dr_res (ok, label) select u.ok, u.lb from unnest(r_ok, r_lb) as u(ok, lb);
end
$cases$;

-- S01 nothing that existed moved (the cases' writes rolled back; the migration only added)
insert into _dr_res (ok, label)
select not exists ((select b.k, b.v from _dr_before b) except (select a.k, a.v from pg_temp.dr_snap() a))
         and not exists (select 1 from public.resource_slug_history) and not exists (select 1 from public.event_slug_history)
         and (select count(*) from public.resources) = (select count(*) from _dr_before b where b.k like 'res:%')
         and (select count(*) from public.events) = (select count(*) from _dr_before b where b.k like 'evt:%'),
       'S01 after the migration and the cases: every article, event, function, table, column, constraint, trigger and policy that existed is unchanged; no test row or old address left: '
       || coalesce((select string_agg(d.k, ',') from ((select b.k, b.v from _dr_before b) except (select a.k, a.v from pg_temp.dr_snap() a)) as d), 'all equal');

-- D. The down, verbatim ──────────────────────────────────────────────────────────
-- DOWN of supabase/migrations/20261020160000_readable_slugs.sql. NOT A MIGRATION: run it only to
-- take readable addresses out (with Victor's OK). It DROPS resources.slug, events.slug and every
-- old address kept in the two history tables (and slug_auto, slug_public); keep a copy first:
--   select r.id, r.slug, r.slug_auto from public.resources r;
--   select e.id, e.slug, e.slug_auto, e.slug_public from public.events e;
--   select * from public.resource_slug_history;
--   select * from public.event_slug_history;
-- After it, /resources/<slug> and /events/<slug> links that were shared stop working (the pages
-- show "not found"; the Rendezvous' address alone keeps opening, the code knows its id). The
-- redesign's code copes with the column gone: it goes back to id addresses, as before the
-- migration. The live site (main) never read a slug and is not affected.
-- Checked by the same dry run as the migration (supabase/dryrun/20261020160000_readable_slugs.dryrun.sql).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- No other SQL function of the public schema relies on what goes away.
do $pre$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prolang <> (select l.oid from pg_language l where l.lanname = 'c')
     and (p.prosrc ilike '%slug_history%' or p.prosrc ilike '%slug_lookup%' or p.prosrc ilike '%smc_slugify%'
          or p.prosrc ilike '%slug_auto%' or p.prosrc ilike '%slug_public%')
     and p.oid is distinct from to_regprocedure('public.smc_slug_assign()')
     and p.oid is distinct from to_regprocedure('public.smc_slug_remember()')
     and p.oid is distinct from to_regprocedure('public.resource_slug_lookup(text)')
     and p.oid is distinct from to_regprocedure('public.event_slug_lookup(text)')
     and p.oid is distinct from to_regprocedure('public.smc_slugify(text)');
  if v_bad is not null then
    raise exception 'readable_slugs down: SQL function(s) use it: %', v_bad;
  end if;
end
$pre$;

drop trigger if exists trg_resources_slug_remember on public.resources;
drop trigger if exists trg_resources_slug_assign on public.resources;
drop trigger if exists events_slug_remember on public.events;
drop trigger if exists events_slug_assign on public.events;
drop function if exists public.resource_slug_lookup(text);
drop function if exists public.event_slug_lookup(text);
drop function if exists public.smc_slug_remember();
drop function if exists public.smc_slug_assign();
drop table if exists public.resource_slug_history;
drop table if exists public.event_slug_history;
-- Drops the unique and format constraints with the columns.
alter table public.resources drop column if exists slug;
alter table public.resources drop column if exists slug_auto;
alter table public.events drop column if exists slug;
alter table public.events drop column if exists slug_auto;
alter table public.events drop column if exists slug_public;
drop function if exists public.smc_slugify(text);

do $post$
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
     or to_regprocedure('public.event_slug_lookup(text)') is not null
     or exists (select 1 from pg_trigger t
                 where t.tgrelid in ('public.resources'::regclass, 'public.events'::regclass)
                   and t.tgname in ('trg_resources_slug_assign', 'trg_resources_slug_remember', 'events_slug_assign', 'events_slug_remember')) then
    raise exception 'readable_slugs down: something is left';
  end if;
end
$post$;
-- ─────────────────────────────────────────────────────────────────────────────────

-- E. Checks after the down, then the report
do $e$
declare
  v_txt text;
begin
  insert into _dr_res (ok, label) values (
    not exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name in ('resources', 'events')
                   and c.column_name in ('slug', 'slug_auto', 'slug_public'))
      and to_regclass('public.resource_slug_history') is null and to_regclass('public.event_slug_history') is null
      and to_regprocedure('public.smc_slugify(text)') is null and to_regprocedure('public.smc_slug_assign()') is null
      and to_regprocedure('public.smc_slug_remember()') is null and to_regprocedure('public.resource_slug_lookup(text)') is null
      and to_regprocedure('public.event_slug_lookup(text)') is null
      and not exists (select 1 from pg_policies pl where pl.tablename in ('resource_slug_history', 'event_slug_history')),
    'E01 the down removed the five columns (slug, slug_auto, slug_public), both history tables and their policies, the five functions and the four triggers');
  insert into _dr_res (ok, label)
  select not exists ((select b.k, b.v from _dr_before b) except (select a.k, a.v from pg_temp.dr_snap() a))
           and not exists ((select a.k, a.v from pg_temp.dr_snap() a) except (select b.k, b.v from _dr_before b)),
         'E02 after the down: every article, event, function, table, column, constraint, trigger and policy exactly as before: '
         || coalesce((select string_agg(d.k, ',') from (((select b.k, b.v from _dr_before b) except (select a.k, a.v from pg_temp.dr_snap() a))
                                                       union all
                                                       ((select a.k, a.v from pg_temp.dr_snap() a) except (select b.k, b.v from _dr_before b))) as d),
                     'all equal');
  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (readable_slugs dry run, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
