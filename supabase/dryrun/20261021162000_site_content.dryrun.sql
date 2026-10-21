-- DRY RUN of supabase/migrations/20261021162000_site_content.sql and of its down.
-- NOT A MIGRATION. ONE query text, ONE execute_sql call, BEFORE the file is applied.
-- Fixtures read at run time: one verified admin/moderator and one verified member (non-staff).
-- Runs the migration verbatim, then the reads and writes the site and the admin make, as their
-- real roles (set local role + request.jwt.claims): anon and members read published blocks only,
-- nobody but staff can publish, nobody writes the tables directly, the history is staff-only and
-- append-only, "back to the original text" hides a block, bad input is refused (22023). Then the
-- down verbatim and a check that everything is gone. Each try runs in a sub-transaction that is
-- always undone (pg_temp._dr_try); the two real publishes (pg_temp._dr_as) and everything else
-- roll back with the final RAISE EXCEPTION 'DRYRUN ...'. Prints labels and SQLSTATEs only.
-- Expected: "29 PASS, 0 FAIL".

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- A. Helpers and fixtures
create temp table _dr_res (n serial, ok boolean, label text) on commit drop;
create temp table _dr_fx (k text primary key, u uuid) on commit drop;

-- One try: runs p_sql as p_role with auth.uid() = p_sub and returns 'ok:<rows>' or the SQLSTATE.
-- It always ends on a private error inside its own sub-transaction: what it wrote, and the role
-- and claims it set, are undone before the next try.
create function pg_temp._dr_try(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $f$
declare
  v_n bigint;
  v_state text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
    execute format('set local role %I', p_role);
    execute p_sql;
    get diagnostics v_n = row_count;
    raise exception using errcode = 'DRY01', message = 'undo';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  if v_state = 'DRY01' then
    return 'ok:' || v_n::text;
  end if;
  return v_state;
end
$f$;

-- A real call, kept until the final rollback, as p_role with auth.uid() = p_sub.
create function pg_temp._dr_as(p_role text, p_sub uuid, p_sql text) returns void
language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
  execute p_sql;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end
$f$;

create function pg_temp._dr_ok(p_label text, p_ok boolean) returns void
language sql as $f$ insert into _dr_res (ok, label) values (coalesce(p_ok, false), p_label) $f$;

insert into _dr_fx (k, u)
select 'staff', p.user_id from public.profiles p join auth.users u on u.id = p.user_id
 where p.persona in ('admin', 'moderator') and p.access_status = 'verified'
 order by p.created_at limit 1;
insert into _dr_fx (k, u)
select 'member', p.user_id from public.profiles p join auth.users u on u.id = p.user_id
 where p.persona not in ('admin', 'moderator') and p.access_status = 'verified'
 order by p.created_at limit 1;

-- B. The migration, verbatim
-- Site pages (CMS), 21 Oct 2026. Admin redesign wave 1, lane cms (branch rf-adm-cms).
-- Down: supabase/migrations/down/20261021162000_site_content.down.sql
-- Dry run: supabase/dryrun/20261021162000_site_content.dryrun.sql (expected "29 PASS, 0 FAIL")
--
-- Additive: two new tables, two new functions, nothing existing is changed. main never reads
-- them. The redesign reads them with the code's own text as fallback (src/lib/siteContent), so
-- the site looks exactly the same until M3 publishes a block, and it keeps working while this
-- file is not applied (the read fails, the code's text shows).
--
-- site_content: one row per editable block.
--   key 'text:<i18n key>'  kind 'text', body {"text": "..."}: replaces one sentence of the site
--                          (the page's t('<i18n key>') call), e.g. 'text:staticPages.about.team.p1'.
--                          Only the editor's pages: keys under staticPages, home, homePage, about,
--                          contact, contentPages, flows, join, legal, help (nothing else can be overridden).
--   key 'legal.<doc>'      kind 'rich', body {"html": "...", "version": "..."}: a legal page's body
--                          (HTML from the admin's editor, sanitized with DOMPurify on display).
--   key 'home.hero', 'help.custom'  kind 'json': the home hero's photo/video and featured event,
--                          the help centre's hidden and added questions.
--   published = false: "back to the original text" (the code's). The row keeps its last body.
-- Read: anon and authenticated read the PUBLISHED rows, columns key, kind, body, published,
--   updated_at only (updated_by is not granted: who changed what is in the staff-only history).
--   A client must name its columns: select('*') is refused (42501). Staff (is_moderator()) read
--   every row.
-- Write: only through site_content_publish (SECURITY DEFINER, search_path '', is_moderator()),
--   which writes the blocks and one history row per block in the same transaction. Clients have
--   no INSERT, UPDATE or DELETE on either table.
-- site_content_history: append-only. Triggers refuse UPDATE, DELETE and TRUNCATE for every role,
--   the owner included (DROP TABLE still works). Staff read it. `page` is the admin page the
--   change was made from ('home', 'about', 'privacy'...), `batch_id` groups one Publish.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.site_content') is not null or to_regclass('public.site_content_history') is not null then
    raise exception 'site_content: the tables exist already (applied already?)';
  end if;
  if to_regprocedure('public.is_moderator()') is null
     or not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.is_moderator()')) then
    raise exception 'site_content: public.is_moderator() is missing or no longer SECURITY DEFINER';
  end if;
end
$pre$;

create table public.site_content (
  key text primary key,
  kind text not null,
  body jsonb not null,
  published boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint site_content_key_format check (key ~ '^(text:(staticPages|home|homePage|about|contact|contentPages|flows|join|legal|help).[A-Za-z0-9_.-]{1,200}|[a-z][a-z0-9_.-]{0,80})$'),
  constraint site_content_kind check (kind in ('text', 'rich', 'json')),
  constraint site_content_kind_matches_key check ((key like 'text:%') = (kind = 'text')),
  constraint site_content_body_shape check (
    jsonb_typeof(body) = 'object'
    and (kind <> 'text' or jsonb_typeof(body -> 'text') = 'string')
    and (kind <> 'rich' or jsonb_typeof(body -> 'html') = 'string')
  ),
  constraint site_content_body_size check (octet_length(body::text) <= 200000)
);

comment on table public.site_content is
  'Editable blocks of the public site (Admin > Site content > Site pages). Written only by site_content_publish. Fallback: the code''s text.';

create table public.site_content_history (
  id bigint generated always as identity primary key,
  batch_id uuid not null,
  page text not null,
  key text not null,
  kind text not null,
  -- null: that block went back to the code's text.
  body jsonb,
  note text,
  changed_at timestamptz not null default now(),
  -- No foreign key: deleting a staff account must not need an UPDATE here.
  changed_by uuid
);

create index site_content_history_page_idx on public.site_content_history (page, id desc);
create index site_content_history_key_idx on public.site_content_history (key, id desc);

comment on table public.site_content_history is
  'Append-only log of every Publish of site_content (one row per block). Staff read it; the admin restores a version from it.';

create function public.site_content_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'site_content_history is append-only' using errcode = '42501';
end
$fn$;

create trigger site_content_history_append_only
  before update or delete on public.site_content_history
  for each row execute function public.site_content_history_append_only();

create trigger site_content_history_no_truncate
  before truncate on public.site_content_history
  for each statement execute function public.site_content_history_append_only();

alter table public.site_content enable row level security;
alter table public.site_content_history enable row level security;

revoke all on table public.site_content from anon, authenticated;
grant select (key, kind, body, published, updated_at) on table public.site_content to anon, authenticated;
revoke all on table public.site_content_history from anon, authenticated;
grant select on table public.site_content_history to authenticated;
revoke all on sequence public.site_content_history_id_seq from anon, authenticated;

create policy site_content_read_published on public.site_content
  for select to anon, authenticated
  using (published);

create policy site_content_read_staff on public.site_content
  for select to authenticated
  using ((select public.is_moderator()));

create policy site_content_history_read_staff on public.site_content_history
  for select to authenticated
  using ((select public.is_moderator()));

-- Publish from the admin. p_items: [{"key": "...", "kind": "text|rich|json", "body": {...} | null}].
-- body null: back to the code's text (published = false). Every block gets a history row.
create function public.site_content_publish(p_page text, p_items jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_batch uuid := gen_random_uuid();
  v_at timestamptz := now();
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_item jsonb;
  v_key text;
  v_kind text;
  v_body jsonb;
  v_n integer := 0;
begin
  if v_uid is null or not public.is_moderator() then
    raise exception 'site_content_publish: M3 staff only' using errcode = '42501';
  end if;
  if p_page is null or p_page !~ '^[a-z][a-z0-9-]{0,40}$' then
    raise exception 'site_content_publish: bad page id' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 400 then
    raise exception 'site_content_publish: p_items must be an array of 1 to 400 blocks' using errcode = '22023';
  end if;
  if (select count(distinct e.item ->> 'key') from jsonb_array_elements(p_items) as e(item)) <> jsonb_array_length(p_items) then
    raise exception 'site_content_publish: every block needs its own key' using errcode = '22023';
  end if;

  for v_item in select e.item from jsonb_array_elements(p_items) as e(item) loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'site_content_publish: each block must be an object' using errcode = '22023';
    end if;
    v_key := v_item ->> 'key';
    v_kind := v_item ->> 'kind';
    v_body := v_item -> 'body';
    if jsonb_typeof(v_body) = 'null' then
      v_body := null;
    end if;
    if v_key is null or v_key !~ '^(text:(staticPages|home|homePage|about|contact|contentPages|flows|join|legal|help).[A-Za-z0-9_.-]{1,200}|[a-z][a-z0-9_.-]{0,80})$' then
      raise exception 'site_content_publish: bad key %', coalesce(v_key, '(none)') using errcode = '22023';
    end if;
    if v_kind is null or v_kind not in ('text', 'rich', 'json') or (v_key like 'text:%') <> (v_kind = 'text') then
      raise exception 'site_content_publish: bad kind for %', v_key using errcode = '22023';
    end if;
    if v_body is not null and (
         jsonb_typeof(v_body) <> 'object'
         or (v_kind = 'text' and jsonb_typeof(v_body -> 'text') is distinct from 'string')
         or (v_kind = 'rich' and jsonb_typeof(v_body -> 'html') is distinct from 'string')
         or octet_length(v_body::text) > 200000) then
      raise exception 'site_content_publish: bad body for %', v_key using errcode = '22023';
    end if;

    if v_body is null then
      update public.site_content
         set published = false, updated_at = v_at, updated_by = v_uid
       where key = v_key;
    else
      insert into public.site_content as c (key, kind, body, published, updated_at, updated_by)
      values (v_key, v_kind, v_body, true, v_at, v_uid)
      on conflict (key) do update
        set kind = excluded.kind, body = excluded.body, published = true,
            updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    end if;

    insert into public.site_content_history (batch_id, page, key, kind, body, note, changed_at, changed_by)
    values (v_batch, p_page, v_key, v_kind, v_body, v_note, v_at, v_uid);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('batch_id', v_batch, 'count', v_n, 'at', v_at);
end
$fn$;

revoke all on function public.site_content_publish(text, jsonb, text) from public, anon;
grant execute on function public.site_content_publish(text, jsonb, text) to authenticated;
revoke all on function public.site_content_history_append_only() from public, anon, authenticated;

-- C. Cases
do $cases$
declare
  v_staff uuid := (select f.u from _dr_fx f where f.k = 'staff');
  v_member uuid := (select f.u from _dr_fx f where f.k = 'member');
  v_me text := current_user;
  v_pub text := $q$select public.site_content_publish('about', '[{"key":"text:about.title","kind":"text","body":{"text":"Dry run title"}}]'::jsonb)$q$;
begin
  if v_staff is null or v_member is null then
    raise exception 'site_content dry run: no verified staff or no verified member to run as';
  end if;

  perform pg_temp._dr_ok('fixture: the staff account passes is_moderator()',
    pg_temp._dr_try('authenticated', v_staff, 'select 1 where public.is_moderator()') = 'ok:1');
  perform pg_temp._dr_ok('fixture: the member account does not',
    pg_temp._dr_try('authenticated', v_member, 'select 1 where public.is_moderator()') = 'ok:0');
  perform pg_temp._dr_ok('anon reads no block before any publish',
    pg_temp._dr_try('anon', null, 'select key, kind, body from public.site_content') = 'ok:0');
  perform pg_temp._dr_ok('anon cannot call site_content_publish (42501)',
    pg_temp._dr_try('anon', null, v_pub) = '42501');
  perform pg_temp._dr_ok('a member cannot publish (42501)',
    pg_temp._dr_try('authenticated', v_member, v_pub) = '42501');
  perform pg_temp._dr_ok('a member cannot insert a block directly (42501)',
    pg_temp._dr_try('authenticated', v_member, $q$insert into public.site_content (key, kind, body) values ('text:about.title', 'text', '{"text":"x"}')$q$) = '42501');
  perform pg_temp._dr_ok('staff cannot insert a block directly either (42501)',
    pg_temp._dr_try('authenticated', v_staff, $q$insert into public.site_content (key, kind, body) values ('text:about.title', 'text', '{"text":"x"}')$q$) = '42501');
  perform pg_temp._dr_ok('staff can publish',
    pg_temp._dr_try('authenticated', v_staff, v_pub) = 'ok:1');

  -- Real publish: three blocks, kept until the final rollback.
  perform pg_temp._dr_as('authenticated', v_staff, $q$select public.site_content_publish('about', '[
    {"key":"text:about.title","kind":"text","body":{"text":"Dry run title"}},
    {"key":"legal.privacy","kind":"rich","body":{"html":"<h2>Article 1</h2><p>Dry run</p>","version":"Version of 21 October 2026"}},
    {"key":"home.hero","kind":"json","body":{"media":"photo","featured":"all"}}]'::jsonb, 'dry run')$q$);

  perform pg_temp._dr_ok('anon reads the 3 published blocks',
    pg_temp._dr_try('anon', null, 'select key, kind, body, published, updated_at from public.site_content') = 'ok:3');
  perform pg_temp._dr_ok('a member reads the 3 published blocks',
    pg_temp._dr_try('authenticated', v_member, 'select key, kind, body from public.site_content') = 'ok:3');
  perform pg_temp._dr_ok('anon cannot read updated_by (42501)',
    pg_temp._dr_try('anon', null, 'select updated_by from public.site_content') = '42501');
  perform pg_temp._dr_ok('select * is refused for anon (columns must be named, 42501)',
    pg_temp._dr_try('anon', null, 'select * from public.site_content') = '42501');
  perform pg_temp._dr_ok('anon cannot read the history (42501)',
    pg_temp._dr_try('anon', null, 'select id from public.site_content_history') = '42501');
  perform pg_temp._dr_ok('a member reads no history',
    pg_temp._dr_try('authenticated', v_member, 'select id from public.site_content_history') = 'ok:0');
  perform pg_temp._dr_ok('staff reads the 3 history rows',
    pg_temp._dr_try('authenticated', v_staff, 'select id, batch_id, page, key, kind, body, note, changed_at, changed_by from public.site_content_history') = 'ok:3');
  perform pg_temp._dr_ok('staff cannot change the history (42501)',
    pg_temp._dr_try('authenticated', v_staff, 'update public.site_content_history set note = null') = '42501');
  perform pg_temp._dr_ok('the owner cannot delete history rows either (trigger, 42501)',
    pg_temp._dr_try(v_me, null, 'delete from public.site_content_history') = '42501');
  perform pg_temp._dr_ok('the owner cannot truncate the history (trigger, 42501)',
    pg_temp._dr_try(v_me, null, 'truncate public.site_content_history') = '42501');
  perform pg_temp._dr_ok('a member cannot write the history directly (42501)',
    pg_temp._dr_try('authenticated', v_member, $q$insert into public.site_content_history (batch_id, page, key, kind) values (gen_random_uuid(), 'about', 'text:about.title', 'text')$q$) = '42501');
  perform pg_temp._dr_ok('staff cannot update a block directly (42501)',
    pg_temp._dr_try('authenticated', v_staff, $q$update public.site_content set body = '{"text":"x"}' where key = 'text:about.title'$q$) = '42501');

  -- Real publish: "back to the original text" for the title.
  perform pg_temp._dr_as('authenticated', v_staff, $q$select public.site_content_publish('about', '[{"key":"text:about.title","kind":"text","body":null}]'::jsonb)$q$);

  perform pg_temp._dr_ok('after "back to the original text", anon reads 2 blocks and staff still sees 3',
    pg_temp._dr_try('anon', null, 'select key from public.site_content') = 'ok:2'
    and pg_temp._dr_try('authenticated', v_staff, 'select key from public.site_content') = 'ok:3');
  perform pg_temp._dr_ok('the history has 4 rows, the last one with body null, by the staff account',
    (select count(*) from public.site_content_history) = 4
    and (select h.body is null and h.changed_by = v_staff from public.site_content_history h order by h.id desc limit 1));
  perform pg_temp._dr_ok('a bad key is refused (22023)',
    pg_temp._dr_try('authenticated', v_staff, $q$select public.site_content_publish('about', '[{"key":"Bad Key!","kind":"json","body":{}}]'::jsonb)$q$) = '22023');
  perform pg_temp._dr_ok('a text key outside the editor pages is refused (22023)',
    pg_temp._dr_try('authenticated', v_staff, $q$select public.site_content_publish('about', '[{"key":"text:preaudit.indicativeNotice","kind":"text","body":{"text":"x"}}]'::jsonb)$q$) = '22023');
  perform pg_temp._dr_ok('a kind that does not match the key is refused (22023)',
    pg_temp._dr_try('authenticated', v_staff, $q$select public.site_content_publish('about', '[{"key":"text:about.title","kind":"rich","body":{"html":"x"}}]'::jsonb)$q$) = '22023');
  perform pg_temp._dr_ok('a text block without its text is refused (22023)',
    pg_temp._dr_try('authenticated', v_staff, $q$select public.site_content_publish('about', '[{"key":"text:about.title","kind":"text","body":{"html":"x"}}]'::jsonb)$q$) = '22023');
  perform pg_temp._dr_ok('the same key twice, an empty list and a bad page id are refused (22023)',
    pg_temp._dr_try('authenticated', v_staff, $q$select public.site_content_publish('about', '[{"key":"home.hero","kind":"json","body":{}},{"key":"home.hero","kind":"json","body":{}}]'::jsonb)$q$) = '22023'
    and pg_temp._dr_try('authenticated', v_staff, $q$select public.site_content_publish('about', '[]'::jsonb)$q$) = '22023'
    and pg_temp._dr_try('authenticated', v_staff, $q$select public.site_content_publish('About Page', '[{"key":"home.hero","kind":"json","body":{}}]'::jsonb)$q$) = '22023');
  perform pg_temp._dr_ok('site_content_publish: SECURITY DEFINER, search_path "", EXECUTE for authenticated only; RLS on both tables',
    (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.site_content_publish(text, jsonb, text)'::regprocedure)
    and not has_function_privilege('anon', 'public.site_content_publish(text, jsonb, text)', 'execute')
    and has_function_privilege('authenticated', 'public.site_content_publish(text, jsonb, text)', 'execute')
    and (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.site_content'::regclass, 'public.site_content_history'::regclass)));
end
$cases$;

-- D. The down, verbatim
-- DOWN for supabase/migrations/20261021162000_site_content.sql
-- Drops site_content_publish, site_content_history (and its append-only triggers), its trigger
-- function and site_content. Every published block and its history are LOST: export them first
-- if they matter (select * from public.site_content; select * from public.site_content_history).
-- Harmless for main (it never reads them). The redesign falls back to the code's text by itself:
-- its read fails quietly and the pages show the text written in the code; Admin > Site pages
-- says the database part is not installed and turns Publish off.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regclass('public.site_content') is null and to_regclass('public.site_content_history') is null
     and to_regprocedure('public.site_content_publish(text, jsonb, text)') is null then
    raise exception 'site_content down: nothing to undo (the tables and the function are not there)';
  end if;
end
$pre$;

drop function if exists public.site_content_publish(text, jsonb, text);
drop table if exists public.site_content_history;
drop function if exists public.site_content_history_append_only();
drop table if exists public.site_content;

-- E. After the down, and the result
do $e$
declare
  v_txt text;
begin
  perform pg_temp._dr_ok('down: both tables and both functions are gone',
    to_regclass('public.site_content') is null and to_regclass('public.site_content_history') is null
    and to_regprocedure('public.site_content_publish(text, jsonb, text)') is null
    and to_regprocedure('public.site_content_history_append_only()') is null);

  select string_agg(case when r.ok then 'PASS ' else 'FAIL ' end || r.label, chr(10) order by r.n) into v_txt from _dr_res r;
  raise exception 'DRYRUN %', format('%s PASS, %s FAIL (site_content, run %s)',
    (select count(*) from _dr_res where ok), (select count(*) from _dr_res where ok is not true), now()) || chr(10) || v_txt;
end
$e$;
