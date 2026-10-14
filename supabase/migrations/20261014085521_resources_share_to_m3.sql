-- Articles chosen for the M3 Monaco website (m3monaco.com, WordPress).
-- The public RSS feed /rss.xml (netlify/edge-functions/rss.ts) lists the published,
-- public resources where this is true; WordPress imports them as an excerpt with a
-- link back to Smart Marina Connect. Ticked per article in the admin editor
-- (AdminResourceDetail). Additive: every existing article stays out of the feed.
alter table public.resources
  add column if not exists share_to_m3 boolean not null default false;

comment on column public.resources.share_to_m3 is
  'Listed in the /rss.xml feed that m3monaco.com imports (published, public articles only).';
