# 0007. Optional pipeline stages degrade the note; they never fail it

- **Status:** accepted
- **Date:** 2026-08-02 (recorded retroactively)

## Context

This ADR exists because of a bug that actually happened, twice, in different
shapes.

The pipeline has five stages. Some are essential (a note without a transcript is
not a note); some are enhancements (a note without an embedding is still
readable, searchable lexically, and correctly filed). Treating all five as
equally fatal produced two real failures:

1. `enrich` set `status = 'enriching'`, threw on a missing API key, and never
   reset it. Notes were stranded in a non-terminal state: invisible to the
   timeline, which filters `status = 'ready'`, with nothing to retry them.
2. A misconfigured *embedding* key made the whole request throw and reset the
   note to `queued` — **after** the expensive Anthropic call had succeeded and
   been persisted. The note could never reach `ready`, so it stayed invisible
   while its paid-for enrichment sat unused in the database.

Neither was visible by reading the code. The second only appeared because one
vendor key was present while another was absent.

## Decision

Three rules, implemented in `_shared/pipeline.ts` (shared by `enrich`,
`transcribe`, and `sweep` — one copy, not two):

1. **Every failure path resolves the status.** A note is never left in a
   non-terminal state; a transient failure returns it to `queued`, and a model
   refusal resolves to `failed`, since re-running the same note against the same
   prompt would refuse again.
2. **Stages 4–5 (embed, relate) are isolated.** Their failure degrades the note
   rather than failing it. Without an embedding, a note still has a summary,
   category, tags, and lexical search, and is missing only from *semantic*
   results.
3. **A missing artifact is its own backfill marker.** No repair queue: an absent
   `note_embeddings` row is what `notes_missing_embeddings()` finds and `sweep`
   fixes. Retries are capped at 5 failed attempts per (note, stage), read from
   `ai_jobs`, after which the note is marked `failed` rather than retried
   forever.

## Consequences

**Good:** partial vendor outages produce partial notes instead of lost ones, and
work already paid for is never discarded. This is principle 2 — never lose a
note — made structural rather than aspirational.

**Cost:**
- **`ready` no longer means "fully enriched."** Every consumer of `ready` has to
  tolerate a missing embedding, and the feature inventory has to distinguish
  "working" from "working, degraded".
- Silent degradation needs monitoring to be noticed at all, and monitoring does
  not exist yet (SB-019).
- The sweep worker is now load-bearing — and nothing schedules it (SB-001).

## Alternatives considered

**Fail the whole note and retry from the start.** Simple, and it throws away a
successful $0.01 model call every time a cheaper downstream stage blips.

**A repair queue table.** More machinery to keep correct than an anti-join over
state that already exists.

## Revisit if

Degraded notes accumulate unnoticed — which would be an argument for surfacing
degradation in the UI, not for making the stages fatal again.
