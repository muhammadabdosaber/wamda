# 0001. Capture writes locally before it touches the network

- **Status:** accepted
- **Date:** 2026-08-01 (recorded retroactively)

## Context

The user has ADHD and thinks in Arabic. A thought has a short window before it
is gone, and any friction inside that window loses it. Network latency is
friction, and network *failure* — a lift, a basement, a plane — is total
friction. Capture is the one operation whose failure loses the product's entire
value.

## Decision

The client writes to IndexedDB before it attempts any network call
(`web/src/data/outbox.ts`). The UI renders from local state, so capture latency
is storage latency. An outbox replays unacknowledged notes when connectivity
allows. The client mints a `client_id` (UUID) at capture time, offline, and that
id is the idempotency key for replay — `capture_note()` is idempotent on it.

## Consequences

**Good:** capture works identically offline and online. Verified in a browser
with no server running, including a note captured while signed out that attached
correctly to whoever signed in afterwards.

**Cost:**
- Ids are minted by an untrusted client, so idempotency has to be enforced
  server-side rather than assumed.
- No server-side ordering. Notes arrive in whatever order the outbox drains.
- Sync only runs while a tab is open — see ADR-0006.
- Retry accounting is subtle: an early bug burned retry attempts against a
  guaranteed 401 while signed out, poisoning the one signal meant to identify
  genuinely stuck notes.

## Alternatives considered

**Write-through to the server.** Simplest correctness story, and it fails at the
exact moment the product exists to serve.

**Server-generated ids with an optimistic placeholder.** Reintroduces the
duplicate-on-retry problem that `client_id` exists to remove.

## Revisit if

Capture is no longer the latency-critical operation — for example if the product
moves to a model where thoughts are captured elsewhere and imported.
