-- SM26 + WYS snapshot (spec §14.2). READ-ONLY: one SELECT, no write.
-- Run it before and after every migration that touches gl_*, profiles, auth
-- triggers or anything near SM26, and compare the two outputs:
--   * section sm26: rows, fingerprint and last_change must be IDENTICAL before
--     and after (SM26 is frozen; the fingerprint is an md5 of every row's full
--     content, so any write shows). "expected" is the 9 Oct 2026 count;
--   * section gl: the "must be 0" lines must say ok; the wys26 token
--     fingerprint must be identical before and after (tokens are printed in
--     QR codes and e-mailed links).
-- Works before and after 20261009210000_registration_core: the check that needs
-- the new tables runs only when they exist (value -1 = not applicable yet).
-- Paste the whole file into one execute_sql call (or psql -f).

with sm26 as (
  select 'sm_registration' as item, count(*) as n,
         md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as fp, max(t.updated_at)::text as last_change, 201 as expected
    from public.sm_registration t
  union all
  select 'sm_role_assignment', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')), max(t.updated_at)::text, 128
    from public.sm_role_assignment t
  union all
  select 'sm_attendee', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')), max(t.updated_at)::text, 263
    from public.sm_attendee t
  union all
  select 'sm_badge', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')), max(t.created_at)::text, 247
    from public.sm_badge t
  union all
  select 'sm_payment', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')), max(t.updated_at)::text, 178
    from public.sm_payment t
  union all
  select 'sm_invoice', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')), max(t.created_at)::text, 41
    from public.sm_invoice t
  union all
  select 'sm_networking_pass', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')), max(t.created_at)::text, 43
    from public.sm_networking_pass t
  union all
  select 'sm_networking_pass (stand, printed)', count(*), md5(coalesce(string_agg(t.id::text || ':' || t.token::text, '|' order by t.id), '')),
         max(t.created_at)::text, 23
    from public.sm_networking_pass t where t.kind = 'stand'
),
wys as (
  select e.id from public.gl_event e where e.slug = 'wys26'
)
select 'sm26' as section, s.item, s.n::text as value, s.fp as fingerprint, s.last_change, s.expected::text as expected,
       case when s.n = s.expected then 'ok' else 'CHANGED since 9 Oct (compare before/after)' end as verdict
  from sm26 s
union all
select 'gl', 'guest-list events (wys26, canary-onsite): rows outside the legacy statuses/sources (must be 0)',
       count(*)::text, null, null, '0', case when count(*) = 0 then 'ok' else 'FAIL' end
  from public.gl_guest g join public.gl_event e on e.id = g.event_id
 where e.slug in ('wys26', 'canary-onsite')
   and (g.status not in ('requested', 'invited', 'confirmed', 'declined', 'rejected', 'cancelled')
        or g.source not in ('request', 'invitation', 'plus_one'))
union all
select 'gl', 'wys26 guests and token fingerprint (identical before/after)',
       count(*)::text, md5(coalesce(string_agg(g.id::text || ':' || g.token::text, '|' order by g.id), '')),
       max(g.created_at)::text, null, 'info'
  from public.gl_guest g where g.event_id = (select id from wys)
union all
select 'gl', 'wys26 by status', string_agg(x.status || '=' || x.n, ', ' order by x.status), null, null, null, 'info'
  from (select g.status, count(*) as n from public.gl_guest g where g.event_id = (select id from wys) group by g.status) x
union all
select 'gl', 'core_v2 confirmed on-site rows without a provisioning job (must be 0; -1 = before registration_core)',
       (xpath('/row/n/text()', query_to_xml(
          case when to_regclass('public.account_provision_job') is not null then
            'select count(*) as n from public.gl_guest g join public.gl_event e on e.id = g.event_id
              where e.engine = ''core_v2'' and e.kind = ''onsite'' and g.status = ''confirmed''
                and not exists (select 1 from public.account_provision_job j
                                 where j.source_kind = ''gl_guest'' and j.source_id = g.id)'
          else 'select -1 as n' end, false, true, '')))[1]::text,
       null, null, '0', 'check value'
union all
select 'gl', 'gl_checkin body md5 (must stay e2a63a98dcb1f5625b24d71f0cda3a62)',
       md5(replace(p.prosrc, chr(13), '')), null, null, 'e2a63a98dcb1f5625b24d71f0cda3a62',
       case when md5(replace(p.prosrc, chr(13), '')) = 'e2a63a98dcb1f5625b24d71f0cda3a62' then 'ok' else 'FAIL' end
  from pg_proc p where p.oid = 'public.gl_checkin(uuid, uuid, uuid, boolean)'::regprocedure
order by 1, 2;
