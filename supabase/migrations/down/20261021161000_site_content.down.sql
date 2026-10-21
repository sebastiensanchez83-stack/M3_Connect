-- DOWN for supabase/migrations/20261021161000_site_content.sql
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
