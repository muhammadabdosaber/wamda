-- ============================================================================
-- 08. Note action state
-- ============================================================================
-- Tracks whether the user has responded to a note's suggested_action chip
-- (accepted or dismissed), WITHOUT touching note_enrichments -- that table
-- stays pipeline-writable-only so the client can never forge AI output.
-- `notes` is already fully client-writable (see 04_rls), so this is a plain
-- column, not a new grant/policy surface.
-- ============================================================================

alter table public.notes
  add column action_dismissed_at timestamptz;
