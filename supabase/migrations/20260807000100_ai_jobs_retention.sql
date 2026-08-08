-- ============================================================================
-- 12. ai_jobs retention (SB-004)
-- ============================================================================
-- ai_jobs takes a row per stage per note per attempt and grows without limit
-- (docs/08-security.md, "Open items before production"). It is pipeline
-- telemetry -- shape, cost, latency, error code, never note content -- so
-- unlike notes there is no reason to keep it forever.
--
-- 90 days: long enough to debug an incident discovered weeks after it
-- happened and to compute a real cost-per-note trend across a full quarter
-- (docs/02-database-schema.md records this number so it never has to be
-- reverse-engineered from a cron schedule); short enough that the table does
-- not become the thing a future metrics pass (SB-020) has to work around.
--
-- No Vault secrets needed here, unlike the sweep/digest schedules -- this
-- never leaves Postgres, so it can schedule unconditionally.
-- ============================================================================

create or replace function public.purge_old_ai_jobs(p_days integer default 90)
returns integer
language sql
security invoker
set search_path = pg_catalog, public
as $$
  with deleted as (
    delete from public.ai_jobs
    where created_at < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*)::integer from deleted;
$$;

comment on function public.purge_old_ai_jobs is
  'Deletes ai_jobs rows older than p_days (default 90, SB-004) and returns the count removed. Pipeline-internal, not granted to authenticated.';

create extension if not exists pg_cron with schema extensions;
grant usage on schema cron to postgres;

-- cron.schedule replaces a job of the same name rather than duplicating it,
-- so this file is safe to re-run. 03:00 UTC: off-peak for a product whose
-- one user is in Asia/Dubai (UTC+4) per docs/09-status-handoff.md.
select cron.schedule(
  'ai-jobs-retention',
  '0 3 * * *',
  $$select public.purge_old_ai_jobs();$$
);
