-- Applied to the remote project via the Supabase MCP; kept here for traceability.
-- Park an award category without deciding its fate. The student architecture
-- prizes have no candidates now that the single student entry is judged in the
-- professional pool, but whether they are retired or kept is not settled — so
-- they are hidden rather than deleted, and come back with one UPDATE:
--   update sm_award set hidden = false where competition = 'architecture_student';
alter table public.sm_award
  add column if not exists hidden boolean not null default false;

update public.sm_award
   set hidden = true
 where competition = 'architecture_student';
