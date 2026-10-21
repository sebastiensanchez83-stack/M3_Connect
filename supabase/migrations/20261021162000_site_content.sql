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
