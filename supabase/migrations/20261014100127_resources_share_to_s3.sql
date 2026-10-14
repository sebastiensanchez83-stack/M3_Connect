-- Articles chosen for the S3 Monaco website (s3monaco.com, WordPress).
-- Same mechanism as share_to_m3: the public RSS feed /rss-s3.xml
-- (netlify/edge-functions/rss.ts) lists the published, public resources where this
-- is true. Ticked per article in the admin editor (AdminResourceDetail).
-- Additive: every existing article stays out of the feed.
alter table public.resources
  add column if not exists share_to_s3 boolean not null default false;

comment on column public.resources.share_to_s3 is
  'Listed in the /rss-s3.xml feed that s3monaco.com imports (published, public articles only).';
