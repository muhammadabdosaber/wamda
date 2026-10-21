import { describe, expect, it } from "vitest";

import { fallbackNotification, isDuePayload, toNotification } from "../src/core/pushMessage";
import { keysOf, urlBase64ToUint8Array } from "../src/data/push";

/**
 * SB-051. What can be asserted about push without a browser.
 *
 * A service worker cannot be unit-tested -- it has no DOM and no module graph
 * a runner will load -- so everything decidable was pushed out of `sw.ts`
 * into `core/pushMessage.ts`, and this is the file that holds it honest.
 * Delivery itself is proven on a real device, not here.
 */

describe("isDuePayload", () => {
  it("accepts the shape functions/push actually sends", () => {
    expect(isDuePayload({ kind: "due-tasks", overdue: 2, dueToday: 1, noteId: null, language: "ar" }))
      .toBe(true);
  });

  it("rejects anything else, so a stray push cannot render as a reminder", () => {
    expect(isDuePayload(null)).toBe(false);
    expect(isDuePayload("due-tasks")).toBe(false);
    expect(isDuePayload({ kind: "something-else", overdue: 1, dueToday: 0, language: "ar" })).toBe(false);
    // A count that arrived as a string would format as "NaN tasks".
    expect(isDuePayload({ kind: "due-tasks", overdue: "2", dueToday: 1, language: "ar" })).toBe(false);
    expect(isDuePayload({ kind: "due-tasks", overdue: 2, dueToday: 1 })).toBe(false);
  });
});

describe("toNotification", () => {
  it("sums overdue and due-today into one Arabic sentence, with the right plural", () => {
    // Arabic has a dual: two tasks is `مهمتان`, not `2 مهام`. This is the
    // same catalogue entry the tab badge uses for its accessible name, which
    // is why the notification cannot drift from what the app says.
    const two = toNotification({ kind: "due-tasks", overdue: 1, dueToday: 1, noteId: null, language: "ar" });
    expect(two.body).toBe("مهمتان متأخرتان أو موعدهما اليوم");

    const one = toNotification({ kind: "due-tasks", overdue: 1, dueToday: 0, noteId: null, language: "ar" });
    expect(one.body).toBe("مهمة واحدة متأخرة أو موعدها اليوم");

    const five = toNotification({ kind: "due-tasks", overdue: 3, dueToday: 2, noteId: null, language: "ar" });
    expect(five.body).toContain("مهام");
  });

  it("carries no display text from the server: the title comes from the catalogue", () => {
    const ar = toNotification({ kind: "due-tasks", overdue: 1, dueToday: 0, noteId: null, language: "ar" });
    const en = toNotification({ kind: "due-tasks", overdue: 1, dueToday: 0, noteId: null, language: "en" });
    expect(ar.title).toBe("مهام مستحقة");
    expect(en.title).toBe("Tasks due");
    expect(en.body).toBe("1 task overdue or due today");
  });

  it("opens the sampled task when there is one, and the Tasks tab otherwise", () => {
    const withNote = toNotification({
      kind: "due-tasks",
      overdue: 1,
      dueToday: 0,
      noteId: "9f1d0f6a-0000-4000-8000-000000000001",
      language: "ar",
    });
    expect(withNote.url).toBe("/?tab=tasks&note=9f1d0f6a-0000-4000-8000-000000000001");

    const withoutNote = toNotification({ kind: "due-tasks", overdue: 1, dueToday: 0, noteId: null, language: "ar" });
    expect(withoutNote.url).toBe("/?tab=tasks");
  });

  it("falls back to a catalogue title rather than showing nothing", () => {
    // A push that shows no notification costs the subscription itself in
    // every browser that enforces userVisibleOnly.
    expect(fallbackNotification().title).toBe("ومضة");
    expect(fallbackNotification("en").title).toBe("Wamda");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes an unpadded base64url VAPID key to the 65 bytes subscribe() wants", () => {
    // A real uncompressed P-256 point, from RFC 8291's own example.
    const key =
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    const bytes = urlBase64ToUint8Array(key);

    expect(bytes.length).toBe(65);
    // 0x04 marks the uncompressed form. A key that decodes to anything else
    // is rejected by `subscribe()` with an InvalidAccessError that names no
    // cause.
    expect(bytes[0]).toBe(0x04);
  });

  it("translates the base64url alphabet, not just the padding", () => {
    // `-` and `_` are the two characters standard base64 does not have, and
    // `atob` throws on them. This is the whole reason the helper exists.
    const bytes = urlBase64ToUint8Array("-_8");
    expect(Array.from(bytes)).toEqual([251, 255]);
  });
});

describe("keysOf", () => {
  it("names the keys by the push_subscriptions columns, not the browser's names", () => {
    // The browser's key is `auth`; the column is `auth_secret`. Sending `auth`
    // made every upsert fail, so no phone ever subscribed (2026-10-21).
    const bytes = { p256dh: [4, 1, 2], auth: [251, 255] } as Record<string, number[]>;
    const row = keysOf({ getKey: (name: string) => new Uint8Array(bytes[name]!).buffer } as never);

    expect(Object.keys(row).sort()).toEqual(["auth_secret", "p256dh"]);
    // base64url, unpadded -- the encoding functions/push decodes.
    expect(row.auth_secret).toBe("-_8");
    expect(row.p256dh).toBe("BAEC");
  });
});
