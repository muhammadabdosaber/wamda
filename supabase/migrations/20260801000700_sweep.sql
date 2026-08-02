-- ============================================================================
-- 07. Sweep worker support
-- ============================================================================
-- The pipeline degrades on purpose rather than losing a note: `enrich` still
-- lands a note at `ready` when the embedding stage fails (see the comment
-- there), and a missing `note_embeddings` row is left as its own backfill
-- marker. Nothing consumed that marker until now.
--
-- `notes_pending_idx` (see 03-indexes) already anticipated the other half of
-- the sweep -- notes stuck in `queued` / `transcribing` / `enriching`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- notes_missing_embeddings -- backfill candidates for the sweep worker
-- ---------------------------------------------------------------------------
-- An anti-join expressed in SQL rather than fetched-then-filtered in the
-- worker: PostgREST cannot express "note_enrichments row with no matching
-- note_embeddings row" without pulling every ready note over the wire first.
-- ---------------------------------------------------------------------------
create or replace function public.notes_missing_embeddings(p_limit integer default 25)
returns table (
  note_id  uuid,
  user_id  uuid,
  language text,
  title    text,
  summary  text,
  raw_text text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select n.id, e.user_id, e.language, e.title, e.summary, n.raw_text
  from public.note_enrichments e
  join public.notes n on n.id = e.note_id
  where n.status = 'ready'
    and n.archived_at is null
    and not exists (
      select 1
      from public.note_embeddings em
      where em.note_id = e.note_id
        and em.language = e.language
    )
  order by n.client_created_at asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

comment on function public.notes_missing_embeddings is
  'Sweep-worker candidates: ready notes whose embedding stage degraded and was never retried. Pipeline-internal, not granted to authenticated.';

-- Deliberately not granted to `authenticated`, same reasoning as
-- attach_tags/relate_note: this is pipeline-internal, and the service role
-- reaches it by virtue of being superuser-adjacent.
