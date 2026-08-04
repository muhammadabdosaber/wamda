-- ============================================================================
-- 09. Task completion
-- ============================================================================
-- A note whose enrichment reads `category = 'task'` can be ticked done on the
-- Tasks screen. It needs somewhere to record that -- and `archived_at` is NOT
-- it: archiving means "gone from the timeline and search for good", while a
-- completed task stays a note and stays findable. They are different states
-- and must not share a column (SB-038).
--
-- Like action_dismissed_at (migration 08), this is the client recording its
-- OWN response, never AI output, so it lives on `notes` -- which is already
-- client-writable under RLS -- and not on note_enrichments.
-- ============================================================================

alter table public.notes
  add column completed_at timestamptz;
