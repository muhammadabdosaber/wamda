import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * Offline-first capture store.
 *
 * THE INVARIANT: a captured thought is durable before any network call is
 * attempted. The UI renders from here and never blocks on connectivity. For
 * the target user this is the difference between a tool they trust and one
 * that occasionally eats a thought -- and one lost thought is enough to stop
 * them using it.
 *
 * IndexedDB rather than localStorage for two reasons that both matter here:
 * localStorage is synchronous (it blocks the main thread on every write, on
 * the one code path that must never stutter), and it stores strings only --
 * whereas IndexedDB stores a `Blob` natively, so a voice recording can sit in
 * the outbox as-is instead of being base64-inflated by a third.
 */

export type NoteSource = "text" | "voice";

export interface OutboxNote {
  /** Minted locally, offline. The server's idempotency key. */
  clientId: string;
  source: NoteSource;
  language: string;
  text?: string;
  audio?: Blob;
  capturedAt: string;
  serverId?: string;
  attempts: number;
  /**
   * SB-020: wall-clock duration of the IndexedDB write below (open the
   * outbox connection -> `put()` resolves), i.e. capture latency as this
   * app defines it (ADR-0001: capture latency is storage latency, not
   * network latency). Measured here rather than by the caller so it covers
   * exactly the write this app promises is durable, nothing more. Sent to
   * the server on sync, whenever that ends up happening -- this field
   * travels with the note through an arbitrarily long offline stretch.
   */
  captureLatencyMs?: number;
}

/**
 * SB-028: a queued mutation on an EXISTING (already-synced) note -- archive
 * or answer a suggestion offline. Keyed by `noteId:field`, not an incrementing
 * id, so a second offline action on the same field (e.g. dismiss, then undo,
 * both before ever reconnecting) collapses to one row instead of queuing two
 * requests that would race on replay -- the later action simply overwrites
 * the earlier queued one, the correct outcome either way.
 */
export interface PendingNoteAction {
  key: string;
  noteId: string;
  field: "archived_at" | "action_dismissed_at";
  value: string | null;
  queuedAt: string;
}

interface SecondBrainDB extends DBSchema {
  outbox: {
    key: string;
    value: OutboxNote;
    indexes: { byCaptured: string };
  };
  noteActions: {
    key: string;
    value: PendingNoteAction;
  };
}

let dbPromise: Promise<IDBPDatabase<SecondBrainDB>> | null = null;

function db(): Promise<IDBPDatabase<SecondBrainDB>> {
  dbPromise ??= openDB<SecondBrainDB>("second-brain", 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore("outbox", { keyPath: "clientId" });
        store.createIndex("byCaptured", "capturedAt");
      }
      if (oldVersion < 2) {
        database.createObjectStore("noteActions", { keyPath: "key" });
      }
    },
  });
  return dbPromise;
}

export async function capture(input: {
  source: NoteSource;
  language: string;
  text?: string;
  audio?: Blob;
}): Promise<OutboxNote> {
  const start = performance.now();
  const database = await db();

  const note: OutboxNote = {
    // The client_id is minted HERE, offline, and is what makes replay
    // idempotent server-side. Letting the server assign the id would turn
    // every retry of an unacknowledged request into a duplicate note.
    clientId: crypto.randomUUID(),
    source: input.source,
    language: input.language,
    capturedAt: new Date().toISOString(),
    attempts: 0,
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.audio !== undefined ? { audio: input.audio } : {}),
  };

  await database.put("outbox", note);
  note.captureLatencyMs = Math.round(performance.now() - start);

  // A second write to attach the measurement, deliberately NOT awaited: the
  // note is already durable after the put above, which is the only promise
  // this function's caller may block on (SB-024 -- capture latency is
  // storage latency). Losing this one field to a killed tab costs a metrics
  // sample, not a thought.
  void database.put("outbox", note);

  return note;
}

/**
 * Unsynced notes, oldest first. Replaying in capture order keeps the
 * server-side timeline coherent when a whole day syncs at once.
 */
export async function pending(limit = 50): Promise<OutboxNote[]> {
  const all = await (await db()).getAllFromIndex("outbox", "byCaptured");
  return all.filter((n) => !n.serverId).slice(0, limit);
}

export async function pendingCount(): Promise<number> {
  return (await pending(Number.MAX_SAFE_INTEGER)).length;
}

export async function markSynced(clientId: string, serverId: string): Promise<void> {
  const database = await db();
  const note = await database.get("outbox", clientId);
  if (!note) return;
  // Audio is dropped once the server has it. Keeping a copy would grow the
  // origin's storage quota without bound, and browsers evict the whole
  // database when a quota is hit -- taking unsynced notes with it.
  await database.put("outbox", { ...note, serverId, audio: undefined });
}

export async function markAttempted(clientId: string): Promise<void> {
  const database = await db();
  const note = await database.get("outbox", clientId);
  if (!note) return;
  await database.put("outbox", { ...note, attempts: note.attempts + 1 });
}

export async function queueNoteAction(
  noteId: string,
  field: PendingNoteAction["field"],
  value: string | null,
): Promise<void> {
  const action: PendingNoteAction = {
    key: `${noteId}:${field}`,
    noteId,
    field,
    value,
    queuedAt: new Date().toISOString(),
  };
  await (await db()).put("noteActions", action);
}

export async function pendingNoteActions(): Promise<PendingNoteAction[]> {
  return (await db()).getAll("noteActions");
}

export async function clearNoteAction(key: string): Promise<void> {
  await (await db()).delete("noteActions", key);
}

/** Test seam: lets a suite point at a fresh database. */
export function __resetForTests(): void {
  dbPromise = null;
}
