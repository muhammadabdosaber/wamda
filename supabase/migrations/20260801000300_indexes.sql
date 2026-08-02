-- ============================================================================
-- 03. Indexes
-- ============================================================================

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
create index notes_search_idx on public.notes using gin (search_vector);

-- The timeline query. Ordered by client_created_at (capture time), not
-- created_at (server receipt) -- an offline batch that syncs at noon must not
-- pile up at noon in the user's day view.
-- Partial: the timeline only ever shows ready, unarchived notes.
create index notes_timeline_idx
  on public.notes (user_id, client_created_at desc)
  where status = 'ready' and archived_at is null;

-- Pipeline worker sweep: find notes still owed work.
create index notes_pending_idx
  on public.notes (status, created_at)
  where status in ('queued', 'transcribing', 'enriching');

create index notes_language_idx on public.notes (user_id, input_language);

-- ---------------------------------------------------------------------------
-- note_enrichments
-- ---------------------------------------------------------------------------
create index note_enrichments_note_idx on public.note_enrichments (note_id, language);

-- Filtered browse: "show me my urgent tasks in Arabic".
create index note_enrichments_facets_idx
  on public.note_enrichments (user_id, language, category, priority);

-- Action inbox: the only rows with a due date that still need a decision.
create index note_enrichments_due_idx
  on public.note_enrichments (user_id, action_due_at)
  where action_due_at is not null;

-- ---------------------------------------------------------------------------
-- note_embeddings
-- ---------------------------------------------------------------------------
-- HNSW over cosine distance. m/ef_construction are the pgvector defaults,
-- stated explicitly so a later tuning change is a visible diff.
-- Opclass is schema-qualified because the vector extension lives in
-- `extensions`, and migration search_path should not be assumed.
create index note_embeddings_hnsw_idx
  on public.note_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index note_embeddings_note_idx on public.note_embeddings (note_id, language, model);

-- ---------------------------------------------------------------------------
-- tags / relations / digests / jobs
-- ---------------------------------------------------------------------------
create index note_tags_tag_idx   on public.note_tags (tag_id);
create index note_tags_user_idx  on public.note_tags (user_id);
create index tag_labels_lang_idx on public.tag_labels (language);

-- Fuzzy tag lookup for the tag picker, over normalized slugs.
create index tags_slug_trgm_idx
  on public.tags using gin (slug extensions.gin_trgm_ops);

create index note_relations_to_idx on public.note_relations (to_note_id);

create index weekly_digests_user_idx
  on public.weekly_digests (user_id, period_start desc, language);

create index ai_jobs_user_idx on public.ai_jobs (user_id, created_at desc);
create index ai_jobs_open_idx on public.ai_jobs (status, created_at)
  where status in ('pending', 'running');
