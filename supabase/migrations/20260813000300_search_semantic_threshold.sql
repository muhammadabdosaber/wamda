-- ---------------------------------------------------------------------------
-- search_notes -- add a similarity floor to the semantic arm
-- ---------------------------------------------------------------------------
-- The semantic arm ranked EVERY note with an embedding by distance and never
-- excluded any of them -- with a small corpus (14 notes today), that meant
-- almost the whole corpus qualified for the top `candidates` and rode the RRF
-- fusion into the results for any query, regardless of actual relevance.
-- Confirmed live 2026-08-13: an unrelated query returned nearly every note.
--
-- The threshold below is NOT `relate_note()`'s 0.78 similarity cutoff -- that
-- number compares two DOCUMENT-type embeddings (Cohere embeds
-- `search_document` inputs symmetrically), while search compares a QUERY
-- embedding against DOCUMENT embeddings, a different, asymmetric vector
-- space the same model was trained for. Measured directly, six real notes
-- against three real queries, real Cohere calls (`embed-multilingual-v3.0`):
-- the correct top match scored similarity 0.41-0.53; the least-relevant note
-- for the SAME query still scored 0.34-0.46. Short, single-sentence Arabic
-- notes compress into a narrow similarity band for this model -- there is no
-- clean gap to cut at. distance <= 0.6 (similarity >= 0.40) keeps every
-- correct top match from that test while dropping the clearly weaker notes
-- for each query; it is a measured, permissive floor, not a precise one.
-- Needs retuning once the corpus is large enough to do that properly (see
-- docs/11-features.md 3.9).
-- ---------------------------------------------------------------------------
create or replace function public.search_notes(
  p_query      text default null,
  p_language   text default 'ar',
  p_embedding  extensions.vector(1024) default null,
  p_mode       text default 'hybrid',
  p_categories public.note_category[] default null,
  p_limit      integer default 20
)
returns table (
  note_id           uuid,
  title             text,
  summary           text,
  category          public.note_category,
  priority          public.note_priority,
  language          text,
  client_created_at timestamptz,
  score             real,
  lexical_rank      integer,
  semantic_rank     integer
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  with params as (
    select
      least(greatest(coalesce(p_limit, 20), 1), 100) as lim,
      coalesce(p_language, 'ar')                     as lang,
      coalesce(p_mode, 'hybrid')                     as mode,
      60.0                                           as rrf_k,
      -- Candidate depth per arm before fusion. 200 is ~10x a typical page,
      -- deep enough that fusion has something to reorder, shallow enough to
      -- stay inside the p95 latency budget.
      200                                            as candidates,
      -- Cosine distance ceiling for the semantic arm -- measured against
      -- real query/document embeddings, not reused from relate_note() (see
      -- the header comment above for why that number does not apply here).
      -- Without this, every note with an embedding ranks somewhere and
      -- shows up in results for any query at all.
      0.6                                            as max_distance
  ),
  tsq as (
    select websearch_to_tsquery(
             public.ts_config_for((select lang from params)),
             public.normalize_for(p_query, (select lang from params))
           ) as q
    where nullif(btrim(coalesce(p_query, '')), '') is not null
  ),
  lexical as (
    select id, row_number() over (order by rank desc, id) as rnk
    from (
      select n.id, ts_rank_cd(n.search_vector, (select q from tsq)) as rank
      from public.notes n
      where (select mode from params) in ('hybrid', 'lexical')
        and exists (select 1 from tsq)
        and n.search_vector @@ (select q from tsq)
        and n.status = 'ready'
        and n.archived_at is null
      order by rank desc
      limit (select candidates from params)
    ) t
  ),
  semantic as (
    select id, row_number() over (order by distance, id) as rnk
    from (
      select distinct on (e.note_id) e.note_id as id, e.embedding <=> p_embedding as distance
      from public.note_embeddings e
      join public.notes n on n.id = e.note_id
      where (select mode from params) in ('hybrid', 'semantic')
        and p_embedding is not null
        and e.language = (select lang from params)
        and n.status = 'ready'
        and n.archived_at is null
      order by e.note_id, distance
    ) t
    where distance <= (select max_distance from params)
    order by distance
    limit (select candidates from params)
  ),
  fused as (
    select
      coalesce(l.id, s.id) as id,
      (coalesce(1.0 / ((select rrf_k from params) + l.rnk), 0.0)
       + coalesce(1.0 / ((select rrf_k from params) + s.rnk), 0.0))::real as score,
      l.rnk::integer as lexical_rank,
      s.rnk::integer as semantic_rank
    from lexical l
    full outer join semantic s on s.id = l.id
  )
  select
    n.id,
    e.title,
    e.summary,
    e.category,
    e.priority,
    coalesce(e.language, n.input_language) as language,
    n.client_created_at,
    f.score,
    f.lexical_rank,
    f.semantic_rank
  from fused f
  join public.notes n on n.id = f.id
  -- LEFT JOIN, not INNER: a note that has been captured but not yet enriched
  -- must still be findable. Requiring an enrichment row would make notes
  -- silently invisible for the seconds-to-minutes the pipeline is running.
  left join public.note_enrichments e
    on e.note_id = n.id
   and e.language = (select lang from params)
  where p_categories is null or e.category = any (p_categories)
  order by f.score desc, n.client_created_at desc
  limit (select lim from params);
$$;

comment on function public.search_notes is
  'Hybrid lexical+semantic note search fused with Reciprocal Rank Fusion (k=60). Semantic arm capped at cosine distance 0.6 (similarity >= 0.40), measured against real query/document embeddings -- NOT relate_note''s 0.78, a different vector-space comparison -- so an unrelated note never rides fusion into results just for existing. SECURITY INVOKER: inherits caller RLS.';
