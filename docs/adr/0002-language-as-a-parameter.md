# 0002. Language is resolved once, carried explicitly, and never stored as a label

- **Status:** accepted
- **Date:** 2026-08-01 (recorded retroactively)

## Context

Phase 1 is Arabic-only; English is planned. The usual outcome of "add a second
language later" is a migration that touches every table, because language
assumptions leak into stored data — categories stored as Arabic words, search
configs hard-coded, prompts with `"ar"` baked in.

There is also a subtler multilingual failure: audio transcribed under one
language and summarized under another, producing output that is wrong in a way
nobody notices until a user complains.

## Decision

Two rules.

1. **One language decision per request**, made at the edge
   (`_shared/language.ts` → `resolveLanguage`), then passed explicitly into
   every downstream stage. No stage infers language on its own.
2. **Never store a display label as a key.** The database stores `task`; the
   word مهمة exists only in `web/src/i18n/ar.ts`.

`en` is *defined and wired* through all seven seams from day one, and merely
disabled — because code that has never run is code that does not work.

## Consequences

**Good:** enabling English is three flags and no migration. `ts_config_for`
already returns `english`, `normalize_latin` already exists, `note_enrichments`
and `note_embeddings` are keyed by language, and `en.ts` is written and
type-checked. Proven end to end in phase 1: real model output stored as `task`
and rendered as مهمة.

**Cost:**
- Every stage signature carries a language argument, including ones that would
  otherwise not care.
- Two language registries exist (server and client) and must agree.
- Dead-ish code: the `en` path is compiled and maintained without being used.

## Alternatives considered

**Detect language per stage.** Cheaper to write, and it produces exactly the
transcribe-in-one-language-summarize-in-another bug.

**Add English later.** The thing this decision exists to prevent.

## Revisit if

The product commits permanently to a single language — then the parameter is
pure overhead.

**Watch:** the phase-2 plan additionally assumes *cross-lingual retrieval* works
(one vector space for both languages). That assumption is untested (SB-006) and
is not part of this ADR — if it fails, this decision still holds; only the
retrieval story changes.
