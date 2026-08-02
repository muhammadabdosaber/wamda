# 0004. Notes are flat — no folders, notebooks, or projects

- **Status:** accepted
- **Date:** 2026-08-01 (recorded retroactively)

## Context

Every hierarchy asks the user a question at capture time: *where does this go?*
For a user whose thought has a few seconds of life, that question is the thing
that loses the thought. It is also a question they cannot answer well — the
right home for an idea is usually only obvious later.

## Decision

Notes are flat, independent objects. There is no containment relationship of any
kind. Organization is emergent: AI-assigned category, priority, and tags, plus
search, plus nearest-neighbour relations between notes.

## Consequences

**Good:** capture asks nothing. The AI files the note afterwards, and a
misfiling is a bad label rather than a lost note. Tags avoid the "which single
folder" problem entirely, since a note can carry several.

**Cost:**
- **Recall depends entirely on search quality.** There is no browsing fallback
  when search fails, which makes SB-005 (semantic arm) and M4 (tuning) load-
  bearing rather than nice-to-have.
- No way to scope a query to a body of work — "everything about the client
  proposal" is a search, not a place.
- Tag identity has to be exactly right, or the graph fragments. Handled by
  `slugify` folding spelling variants; proven on real model output where
  `عروض-أسعار` and `عروض-اسعار` converged.

## Alternatives considered

**Optional folders.** "Optional" organization decays into either unused or
mandatory, and the unused case still costs a UI decision at capture time.

**Auto-assigned projects.** A hierarchy the AI picks is a hierarchy that is
wrong sometimes, with no cheap way for the user to notice.

## Revisit if

The user reports losing notes they know exist — that is search failing, and the
honest fix might be structure rather than better ranking. Note that the user has
flagged an unspecified design change; this is one of the decisions most likely
to be in scope for it.
