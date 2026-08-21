# 0005. Search fuses a lexical and a semantic arm with RRF

- **Status:** accepted
- **Date:** 2026-08-01 (recorded retroactively)

## Context

With no hierarchy (ADR-0004), search *is* recall. Two failure modes matter:

- The user remembers a word but spells it differently than it was stored.
  Arabic makes this routine — hamza forms, taa marbuta, tatweel, harakat.
- The user remembers the meaning but none of the words.

Neither retrieval method covers both. The Postgres `arabic` snowball stemmer
handles MSA morphology reasonably and dialectal Arabic considerably less well.

## Decision

Two arms, fused by Reciprocal Rank Fusion in SQL (migration `…000500`):

- **Lexical** — a generated `search_vector` over normalized text, using
  `ts_config_for(language)`. Normalization folds Arabic spelling variants at
  write and query time.
- **Semantic** — Cohere `embed-multilingual-v3.0`, 1024 dimensions, in pgvector.
  The same embeddings drive nearest-neighbour note relations at a 0.78 threshold.

Fusion happens in the database, not in the client.

## Consequences

**Good:** spelling variance is handled by normalization (verified: a note stored
with taa-marbuta is found by a query typed with haa), and vocabulary mismatch is
handled by the vector arm. An unenriched note is still findable lexically —
verified — so retrieval does not depend on the AI pipeline having succeeded.

**Cost:**
- Two arms to tune, and the weights plus the 0.78 threshold are **untuned**.
  Tuning against three test notes would be meaningless; it needs ~100 real
  notes. **Update 2026-08-13 (SB-045):** a distance floor of 0.6 was added to
  the semantic arm after it matched nearly the whole corpus — measured on 6
  notes and 3 real queries, so it is a grounded placeholder, not a tuned
  number (SB-048).
- Recall now has a vendor dependency. **Update 2026-08-13 (SB-005/045):** the
  semantic arm runs for real — every `ready` note carries a Cohere embedding
  and hybrid search is live on hosted. The dependency is now load-bearing
  rather than theoretical: with no Cohere key, `/search` used to throw before
  the lexical arm ever ran, which is how "search returns nothing, always"
  reached production.
- `relate_note()` has still never been confirmed to produce a row — it is
  called, but nothing reads `note_relations` yet.
- Embedding cost and latency on every note.

## Alternatives considered

**Lexical only.** Free and fast; loses every query where the user remembers the
idea and not the words — which is most of them, months later.

**Semantic only.** Loses exact-token recall (names, numbers) and makes search
completely unavailable whenever the embedding vendor is down or unpaid.

## Revisit if

Measured recall shows one arm contributing nothing, or cross-lingual retrieval
fails (SB-006) — the second would not remove the semantic arm, but it would
change what phase 2 can promise.
