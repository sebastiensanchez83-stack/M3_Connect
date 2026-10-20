-- Public read of the Smart Marina award winners, by company (20 Oct 2026, Victor: the winner
-- badge on company pages and directory cards, one of the "ideas before 13 Nov").
-- Down: supabase/migrations/down/20261020130000_org_award_wins.down.sql.
-- Dry run: supabase/dryrun/20261020130000_org_award_wins.dryrun.sql
-- (runs this file, checks it as anon and authenticated, then the down, in one rolled-back transaction).
--
-- sm_award_results(p_event_id) already shows the confirmed winners publicly, but by name only
-- ("winner_title"): a company page cannot tell whether a winner is itself. This adds ONE
-- read-only SECURITY DEFINER function that returns, for every confirmed and visible award whose
-- winning entry belongs to a company page, that page's id and the award's label and edition.
--   - No personal data: no names, no e-mails, no entry texts; only ids already public on
--     /organizations/<slug> and award labels already public on /sm26/vote.
--   - Same filter as sm_award_results: confirmed = true and not hidden. Nothing shows until M3
--     staff choose and confirm a winner in Admin > SM26 > Awards (on 20 Oct none is confirmed).
--   - The company is the entry's own organization_id, else its registration's. A company merged
--     into another (organizations.duplicate_of) answers with the company it was merged into.
--   - Writes nothing, changes no table, no policy, no other function. sm_* stays frozen.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $pre$
begin
  if to_regprocedure('public.org_award_wins()') is not null then
    raise exception 'org_award_wins: the function already exists';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public'
         and (c.table_name, c.column_name) in (('sm_award', 'winner_role_assignment_id'), ('sm_award', 'confirmed'),
              ('sm_award', 'hidden'), ('sm_award', 'label'), ('sm_award', 'key'), ('sm_award', 'competition'),
              ('sm_award', 'type'), ('sm_award', 'sort'), ('sm_award', 'event_id'), ('sm_event', 'start_date'),
              ('sm_event', 'slug'), ('sm_role_assignment', 'organization_id'), ('sm_role_assignment', 'registration_id'),
              ('sm_registration', 'organization_id'), ('organizations', 'duplicate_of'))) <> 15 then
    raise exception 'org_award_wins: a column it reads is missing';
  end if;
end
$pre$;

create function public.org_award_wins()
returns table (
  organization_id uuid,
  award_key text,
  award_label text,
  competition text,
  award_type text,
  edition_year integer,
  event_slug text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(o.duplicate_of, o.id),
         a.key,
         a.label,
         a.competition,
         a.type,
         extract(year from e.start_date)::integer,
         e.slug
    from sm_award a
    join sm_event e on e.id = a.event_id
    join sm_role_assignment ra on ra.id = a.winner_role_assignment_id
    join sm_registration r on r.id = ra.registration_id
    join organizations o on o.id = coalesce(ra.organization_id, r.organization_id)
   where a.confirmed = true
     and not a.hidden
   order by e.start_date desc, a.sort;
$fn$;

comment on function public.org_award_wins() is
  'Confirmed, visible Smart Marina award wins by company page (organization id, award key/label, competition, type, edition year, event slug). Public, read-only; the winner badge on company pages and directory cards. 20261020130000.';

revoke all on function public.org_award_wins() from public;
grant execute on function public.org_award_wins() to anon, authenticated, service_role;
