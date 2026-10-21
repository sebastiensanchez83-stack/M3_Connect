-- Admin home, "This week": how many messages companies exchanged (Victor's proposal, 21 Oct 2026).
-- conversation_messages is readable only by the two sides of a conversation (msg_can_access), so
-- M3 cannot count it with a plain select. This function returns two numbers and never a message:
--   {"last_7_days": n, "total": n}   (deleted messages left out)
-- Verified admins only (is_admin()); anyone else gets 42501. Read-only (STABLE).
-- Additive: one new function, nothing else changes. The live site (main) never calls it; the
-- refonte admin home shows "not counted yet" until it is installed.
-- Down: supabase/migrations/down/20261021150000_admin_home_message_counts.down.sql
-- Dry run: supabase/dryrun/20261021150000_admin_home_message_counts.dryrun.sql

create or replace function public.admin_home_message_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'last_7_days', (select count(*) from public.conversation_messages m
                     where m.deleted_at is null and m.created_at > now() - interval '7 days'),
    'total',       (select count(*) from public.conversation_messages m where m.deleted_at is null));
end;
$$;

revoke all on function public.admin_home_message_counts() from public, anon;
grant execute on function public.admin_home_message_counts() to authenticated;

comment on function public.admin_home_message_counts() is
  'Admin home figure: messages between companies, last 7 days and total, deleted ones left out. Verified admins only (42501 otherwise). Counts only, never a message. 2026-10-21.';
