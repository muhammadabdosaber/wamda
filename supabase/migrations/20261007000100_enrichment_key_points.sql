-- ============================================================================
-- 17. Key points on an enrichment
-- ============================================================================
-- A spoken note often carries several separate things -- "review X, then copy
-- it to UAT, and also check how Y links to Z". The 1-3 sentence `summary`
-- re-told all of them as one paragraph, which read almost identically to the
-- transcript under it: the owner could not see what the AI had added.
--
-- `key_points` is that list, one item per entry, in the note's own language.
-- Empty -- the default -- when the note is a single thought; splitting one
-- sentence into fragments would be noise.
--
-- Its own column rather than a key inside `context`: `context` is metadata
-- ABOUT the note (people, places), this is the note's content, and the detail
-- view reads it directly.
--
-- Additive, with a default, so every existing row is valid as it stands and
-- nothing is backfilled: old notes keep their summary, new ones get points.
--
-- DEPLOY ORDER: `supabase db push` BEFORE `supabase functions deploy`. The new
-- pipeline writes this column; against a database without it, the upsert
-- fails (and since this change, a failed upsert returns the note to `queued`
-- for the sweep to retry rather than marking it `ready` with no enrichment).
-- ============================================================================

alter table public.note_enrichments
  add column if not exists key_points text[] not null default '{}';

comment on column public.note_enrichments.key_points is
  'Separate items the note contains, one per entry, in the note''s language. Empty when the note is a single thought.';
