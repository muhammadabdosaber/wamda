-- ============================================================================
-- 10. Scope the client's UPDATE grant on notes to the columns it owns
-- ============================================================================
-- Migration 04 granted `update` on ALL columns of public.notes to the
-- authenticated role. RLS still confines a client to its own rows, so the
-- blast radius is a user's own data -- but within that, a client could set
-- `status = 'ready'` on a queued note, rewrite `raw_text` after enrichment was
-- already paid for, or forge `client_created_at`. RLS is the only authorization layer
-- here (ADR-0003), so silently poisoning the pipeline's own inputs is still
-- worth closing (SB-023).
--
-- The client legitimately writes exactly these columns, all of which are the
-- user recording their OWN response to a note, never AI output:
--   archived_at         -- "hide this for good"        (migration 04 / api.ts)
--   action_dismissed_at -- "I answered the suggestion" (migration 08 / api.ts)
--   completed_at        -- "this task is done"         (migration 09 / api.ts)
--   updated_at          -- touched by capture_note's idempotent upsert, which
--                          is SECURITY INVOKER and so runs as the caller
--                          (`on conflict ... do update set updated_at = now()`)
--
-- A column-level UPDATE privilege means Postgres rejects any UPDATE whose SET
-- list touches a column the role lacks -- so `update notes set status=...`
-- becomes "permission denied", while archive / dismiss / complete keep working.
-- Everything else on notes (enrichment, sweep) runs under the service role,
-- which keeps its blanket grant from migration 04 and is unaffected.
-- ============================================================================

revoke update on public.notes from authenticated;

grant update (archived_at, action_dismissed_at, completed_at, updated_at)
  on public.notes to authenticated;
