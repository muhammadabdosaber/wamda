# 0003. Supabase, with RLS as the authorization layer

- **Status:** accepted
- **Date:** 2026-08-01 (recorded retroactively)

## Context

A single-developer project needs Postgres (pgvector, full-text search, Arabic
normalization), auth, file storage, and somewhere to run code that holds vendor
API keys. Building four of those separately is most of the project.

## Decision

Supabase. The client ships **only** the anon key and talks to PostgREST
directly, with **Row Level Security as the authorization layer** — not as
defense-in-depth behind an application-layer check. Edge Functions exist only
where a vendor key or multi-step orchestration is required; everything else goes
through PostgREST, where RLS enforces ownership with no application code to
review.

Vendor keys (Anthropic, ElevenLabs, Cohere) live only in function secrets.
Anything with a `VITE_` prefix is compiled into JavaScript any visitor can read.

## Consequences

**Good:** ownership is enforced in one place, in the database, for every access
path at once. Verified independently on `notes`, `note_tags`, and
`note_embeddings`: user B authenticating and querying user A's note id directly
gets zero rows.

**Cost:**
- **An RLS mistake is a data breach**, not a degraded experience. There is no
  second layer.
- Every new table needs a policy *and* a table-level grant. This bit us: the
  policies were correct while `authenticated` had no `GRANT`, so every client
  query would have failed `permission denied for table notes`. `verify.sql` now
  asserts RLS on every public table.
- Vendor lock-in at the auth and storage layers; Postgres itself is portable.
- Local development needs Docker, and the local Edge Runtime serves stale
  compiled code after edits (see `docs/15-runbook.md`).

## Alternatives considered

**A conventional API server in front of Postgres.** Every endpoint becomes a
place to forget an ownership check; RLS makes that structurally impossible.

**Firebase.** No Postgres, so no pgvector, no Arabic full-text search, no
`generated` search vectors — the retrieval half of the product would have to be
rebuilt elsewhere.

## Revisit if

The product becomes multi-user or shared. RLS policies here assume one owner per
row, and collaboration is a different policy model, not a new column.
