-- ============================================================================
-- 11. Per-user rate limit gate (SB-002)
-- ============================================================================
-- `/enrich` and `/transcribe` are unbounded today: a runaway client loop is a
-- runaway vendor bill, and both endpoints call paid APIs. `ai_jobs` already
-- records every vendor-call attempt per user/stage/timestamp -- it is the
-- counter, so no new table is needed.
--
-- The threshold check is a single SQL function rather than inline Deno code
-- for the same reason `notes_missing_embeddings` is: it is the one place the
-- condition is expressed, callable from the Edge Functions AND provable here
-- against a live count, not asserted from reading TypeScript.
-- ============================================================================

create or replace function public.rate_limit_hit(
  p_user_id         uuid,
  p_stage           public.job_stage,
  p_limit           integer,
  p_window_minutes  integer
) returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select count(*) >= p_limit
  from public.ai_jobs
  where user_id = p_user_id
    and stage = p_stage
    and created_at >= now() - make_interval(mins => p_window_minutes);
$$;

comment on function public.rate_limit_hit is
  'True once a user has made p_limit or more ai_jobs rows for a stage within the trailing p_window_minutes. Pipeline-internal (SB-002), not granted to authenticated -- a client must not be able to probe or reset its own limit.';

-- Deliberately not granted to `authenticated`, same reasoning as
-- attach_tags/relate_note/notes_missing_embeddings: this is pipeline-internal,
-- and the service role reaches it by virtue of being superuser-adjacent.
