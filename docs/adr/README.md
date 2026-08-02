# Architecture Decision Records

Decisions that are expensive to reverse, with the reasoning that produced them
and the cost each one accepts. They were made before this log existed and are
recorded here retroactively from the design docs and the code — the dates are
"as of the first commit", not the day someone deliberated.

**Why bother:** every entry below has a cost attached. Six months from now,
someone will hit that cost and want to undo the decision. This log exists so
they undo it knowing what it was buying, rather than rediscovering the reason
the hard way.

| # | Decision | Status | Cost it accepts |
|---|---|---|---|
| [0001](0001-local-first-capture.md) | Local-first capture with an outbox | accepted | Idempotency everywhere; no server-side ordering |
| [0002](0002-language-as-a-parameter.md) | Language resolved once, carried; never a stored label | accepted | Every stage takes a language argument |
| [0003](0003-supabase-and-rls.md) | Supabase, with RLS as *the* authorization layer | accepted | An RLS mistake is a data breach |
| [0004](0004-flat-notes-no-hierarchy.md) | Flat notes — no folders, notebooks, or projects | accepted | Recall depends entirely on search quality |
| [0005](0005-hybrid-search.md) | Hybrid lexical + semantic search fused by RRF | accepted | Two arms to tune; a vendor dependency for recall |
| [0006](0006-pwa-over-native.md) | PWA rather than native | accepted | No background sync; iOS voice capture uncertain |
| [0007](0007-stage-isolation.md) | Optional pipeline stages degrade, never fail the note | accepted | "Ready" can mean partially enriched |

## Writing a new one

Copy [`template.md`](template.md). Number sequentially. An ADR is for decisions
that are **expensive to reverse** — a library choice usually is not; a storage
model, a language seam, or an authorization strategy is.

Never edit an accepted ADR's decision. Supersede it with a new one and mark the
old `superseded by 00NN`. The wrong turn is the useful part of the record.
