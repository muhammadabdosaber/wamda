-- ============================================================================
-- 13. Audio retention enforcement (SB-009)
-- ============================================================================
-- `profiles.audio_retention_days` has existed since the first migration and
-- nothing has ever read it -- storing a user's voice longer than promised is
-- a privacy failure, not a cleanup task (docs/08-security.md).
--
-- Retention is per-user (`audio_retention_days`, default 30), so it cannot be
-- expressed as a single global cutoff -- this function does the join once,
-- the same reason `notes_missing_embeddings` exists instead of a flat filter.
-- ============================================================================

create or replace function public.notes_audio_expired(p_limit integer default 25)
returns table (
  note_id    uuid,
  user_id    uuid,
  audio_path text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select n.id, n.user_id, n.audio_path
  from public.notes n
  join public.profiles p on p.id = n.user_id
  where n.audio_path is not null
    and n.client_created_at < now() - make_interval(days => p.audio_retention_days)
  order by n.client_created_at asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

comment on function public.notes_audio_expired is
  'Notes whose audio has outlived the owning user''s audio_retention_days. Deleting the Storage object itself needs the Storage API, not SQL -- consumed by supabase/functions/sweep, same as notes_missing_embeddings. Pipeline-internal, not granted to authenticated.';
