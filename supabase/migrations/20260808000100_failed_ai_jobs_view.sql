-- ============================================================================
-- 13. Queryable pipeline failures (SB-019)
-- ============================================================================
-- ai_jobs already carries note_id, stage, status, error_code, latency_ms,
-- cost_usd on every enrich/transcribe/embed/digest attempt (migration 02) --
-- the raw data this task wanted already exists. What was missing was a way
-- to ask "what's currently broken" without hand-writing SQL each time.
--
-- Scoped with the owner 2026-08-08 (docs/13-tasks.md): a view, not alerting.
-- No push/email channel, no restructuring of the functions' console.log
-- calls -- both stay out of scope for this pass.
--
-- "Currently failing" means the LATEST attempt at a given note+stage is
-- 'failed' -- a stage that failed once and then succeeded on retry must not
-- show up here, or this becomes noise instead of a punch list.
--
-- Deliberately NOT granted to `authenticated`. The intended reader is the
-- owner via Supabase Studio, which connects as the Postgres superuser and
-- bypasses RLS entirely -- there is no client-facing use case yet, and
-- granting this to `authenticated` would need `security_invoker` on the view
-- (Postgres views run as their owner, not the querying role, by default) to
-- keep ai_jobs's own RLS from being silently bypassed. Add that the day this
-- view is meant to be read by the app itself, not before.
-- ============================================================================

create or replace view public.failed_ai_jobs as
select *
from (
  select distinct on (j.note_id, j.stage)
    j.id,
    j.note_id,
    j.user_id,
    j.stage,
    j.status,
    j.error_code,
    j.attempt,
    j.latency_ms,
    j.created_at,
    j.finished_at
  from public.ai_jobs j
  where j.note_id is not null
  order by j.note_id, j.stage, j.created_at desc, j.attempt desc
) latest_attempt
where latest_attempt.status = 'failed';

comment on view public.failed_ai_jobs is
  'One row per note+stage whose most recent attempt is still failed (SB-019). Filter by note_id or stage directly -- e.g. select * from failed_ai_jobs where note_id = ''...''. Excludes digest (note_id is null); ops-only, not granted to authenticated.';
