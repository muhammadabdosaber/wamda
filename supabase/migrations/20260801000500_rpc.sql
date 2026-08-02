-- ============================================================================
-- 05. RPCs
-- ============================================================================

-- ---------------------------------------------------------------------------
-- capture_note -- idempotent offline replay
-- ---------------------------------------------------------------------------
-- The client mints client_id at capture time, before it may have any network.
-- When the outbox replays, a note that already landed must resolve to the
-- same row rather than a duplicate. The `do update` (rather than
-- `do nothing`) exists purely so the statement still RETURNS the id on
-- conflict -- `do nothing` returns zero rows and the client can't resolve
-- its local record.
-- ---------------------------------------------------------------------------
create or replace function public.capture_note(
  p_client_id      uuid,
  p_source         public.note_source,
  p_language       text default 'ar',
  p_raw_text       text default null,
  p_client_created timestamptz default now()
)
returns uuid
language sql
security invoker
set search_path = pg_catalog, public
as $$
  insert into public.notes (client_id, source, input_language, raw_text, client_created_at, status)
  values (
    p_client_id,
    p_source,
    coalesce(p_language, 'ar'),
    nullif(btrim(p_raw_text), ''),
    coalesce(p_client_created, now()),
    case when p_source = 'text' then 'queued'::public.note_status
         else 'draft'::public.note_status end
  )
  on conflict (user_id, client_id) do update
    set updated_at = now()
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- search_notes -- hybrid retrieval (lexical + semantic, RRF-fused)
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER is load-bearing: the function inherits the caller's RLS,
-- so cross-user leakage is structurally impossible. A SECURITY DEFINER search
-- function would have to re-implement the ownership filter by hand, and any
-- slip there is a full data breach.
--
-- Fusion is Reciprocal Rank Fusion (k = 60): score = SUM(1 / (k + rank_i)).
-- RRF is used rather than a weighted blend of raw scores because BM25 ranks
-- and cosine distances are not on comparable scales -- normalizing them
-- against each other requires per-corpus tuning that drifts as the corpus
-- grows. RRF only reads ordinal position, so it needs no tuning.
--
-- Arabic matters here: a purely lexical search misses synonyms and dialectal
-- variants, while a purely semantic search misses exact proper nouns. The
-- hybrid is not a nicety for this corpus.
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
      200                                            as candidates
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
  'Hybrid lexical+semantic note search fused with Reciprocal Rank Fusion (k=60). SECURITY INVOKER: inherits caller RLS.';

-- ---------------------------------------------------------------------------
-- attach_tags -- called by the enrichment pipeline (service role)
-- ---------------------------------------------------------------------------
-- Tag identity lives in one place. The model returns Arabic display labels;
-- this collapses them to a normalized, language-neutral slug so that two
-- spellings of the same concept converge on one tag instead of fragmenting
-- the graph. The Arabic label is stored alongside, per language.
-- ---------------------------------------------------------------------------
create or replace function public.attach_tags(
  p_user_id  uuid,
  p_note_id  uuid,
  p_language text,
  p_labels   text[]
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_label text;
  v_slug  text;
  v_tag   uuid;
  v_count integer := 0;
begin
  foreach v_label in array coalesce(p_labels, '{}'::text[]) loop
    v_slug := public.slugify(v_label, p_language);
    continue when v_slug is null;

    insert into public.tags (user_id, slug)
    values (p_user_id, v_slug)
    on conflict (user_id, slug) do update set slug = excluded.slug
    returning id into v_tag;

    insert into public.tag_labels (tag_id, language, label)
    values (v_tag, p_language, btrim(v_label))
    on conflict (tag_id, language) do nothing;

    insert into public.note_tags (note_id, tag_id, user_id)
    values (p_note_id, v_tag, p_user_id)
    on conflict (note_id, tag_id) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- relate_note -- nearest-neighbour link detection, no model call
-- ---------------------------------------------------------------------------
create or replace function public.relate_note(
  p_user_id   uuid,
  p_note_id   uuid,
  p_language  text,
  p_threshold real default 0.78,
  p_limit     integer default 5
)
returns integer
language sql
security invoker
set search_path = pg_catalog, public, extensions
as $$
  with src as (
    select embedding, model
    from public.note_embeddings
    where note_id = p_note_id and language = p_language
    order by chunk_index
    limit 1
  ),
  nearest as (
    select distinct on (e.note_id)
           e.note_id,
           1 - (e.embedding <=> (select embedding from src)) as similarity
    from public.note_embeddings e
    join public.notes n on n.id = e.note_id
    where e.user_id = p_user_id
      and e.note_id <> p_note_id
      and e.language = p_language
      and e.model = (select model from src)
      and n.archived_at is null
    order by e.note_id, e.embedding <=> (select embedding from src)
  ),
  picked as (
    select note_id, similarity
    from nearest
    where similarity >= p_threshold
    order by similarity desc
    limit p_limit
  ),
  ins as (
    insert into public.note_relations (from_note_id, to_note_id, user_id, kind, score)
    select p_note_id, note_id, p_user_id, 'similar'::public.relation_kind, similarity
    from picked
    on conflict (from_note_id, to_note_id, kind)
      do update set score = excluded.score
    returning 1
  )
  select count(*)::integer from ins;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function public.capture_note(uuid, public.note_source, text, text, timestamptz) to authenticated;
grant execute on function public.search_notes(text, text, extensions.vector, text, public.note_category[], integer) to authenticated;
-- attach_tags / relate_note are pipeline-internal; the service role reaches
-- them by virtue of being superuser-adjacent, and the client has no reason to
-- call them. Deliberately not granted to `authenticated`.
