import { describe, expect, it } from "vitest";

import { bucketOf, dueSoonCount, isOverdue, type DueTask } from "../src/core/due";

/**
 * SB-050. These assertions are the whole contract behind the tab badge: the
 * number the user sees, and the "overdue" mark on a row. The screen renders
 * them, it does not decide them -- which is why they are testable at all under
 * vitest's `environment: "node"`.
 *
 * Every date here is built with the LOCAL-time `Date` constructor rather than
 * written as an ISO string with a fixed offset. The buckets are local-day
 * boundaries, so a literal like `2026-08-21T00:00:00+04:00` lands in a
 * different bucket depending on the machine's timezone, and the suite would
 * pass in Dubai and fail on a UTC runner. Constructing locally makes "the
 * first instant of tomorrow" mean that everywhere.
 */
const NOW = new Date(2026, 7, 20, 14, 0, 0); // 20 Aug 2026, 14:00 local

/** `action_due_at` is a string on the wire, so the tests feed strings. */
function at(...args: [number, number, number, number?, number?, number?, number?]): string {
  const [y, m, d, h = 0, min = 0, s = 0, ms = 0] = args;
  return new Date(y, m, d, h, min, s, ms).toISOString();
}

/** Minimal shape of a timeline row, built inline so a failure points at the
 *  field that matters rather than at a fixture file. */
function task(due: string | null, extra: Partial<DueTask> = {}): DueTask {
  return {
    completed_at: null,
    note_enrichments: [{ category: "task", action_due_at: due }],
    ...extra,
  };
}

describe("bucketOf", () => {
  it("puts a date already past in today, not in a bucket of its own", () => {
    expect(bucketOf(at(2026, 7, 17, 9), NOW)).toBe("today");
  });

  it("puts later the same day in today", () => {
    expect(bucketOf(at(2026, 7, 20, 23), NOW)).toBe("today");
  });

  it("puts tomorrow in week", () => {
    expect(bucketOf(at(2026, 7, 21, 9), NOW)).toBe("week");
  });

  it("puts a date past the seventh day in later", () => {
    expect(bucketOf(at(2026, 8, 2, 9), NOW)).toBe("later");
  });

  it("puts a task with no date in later", () => {
    expect(bucketOf(null, NOW)).toBe("later");
  });

  it("keeps the last instant of today out of tomorrow", () => {
    expect(bucketOf(at(2026, 7, 20, 23, 59, 59, 999), NOW)).toBe("today");
    expect(bucketOf(at(2026, 7, 21, 0, 0, 0, 0), NOW)).toBe("week");
  });
});

describe("isOverdue", () => {
  it("is true only once the date is behind us", () => {
    expect(isOverdue(at(2026, 7, 20, 13, 59), NOW)).toBe(true);
    expect(isOverdue(at(2026, 7, 20, 14, 1), NOW)).toBe(false);
  });

  it("is false for a task with no date", () => {
    expect(isOverdue(null, NOW)).toBe(false);
  });
});

describe("dueSoonCount", () => {
  it("counts overdue and due-today together", () => {
    expect(dueSoonCount([task(at(2026, 7, 17, 9)), task(at(2026, 7, 20, 20))], NOW)).toBe(2);
  });

  it("does not count a task due later in the week", () => {
    expect(dueSoonCount([task(at(2026, 7, 23, 9))], NOW)).toBe(0);
  });

  it("does not count a task that is already completed", () => {
    const done = task(at(2026, 7, 17, 9), { completed_at: at(2026, 7, 18, 10) });
    expect(dueSoonCount([done], NOW)).toBe(0);
  });

  it("does not count a note the model did not call a task", () => {
    const idea: DueTask = {
      completed_at: null,
      note_enrichments: [{ category: "idea", action_due_at: at(2026, 7, 17, 9) }],
    };
    expect(dueSoonCount([idea], NOW)).toBe(0);
  });

  it("does not count a task with no date, which is not urgent by omission", () => {
    expect(dueSoonCount([task(null)], NOW)).toBe(0);
  });

  it("ignores a note whose enrichment has not arrived yet", () => {
    expect(dueSoonCount([{ completed_at: null, note_enrichments: [] }], NOW)).toBe(0);
  });

  it("is zero for an empty timeline", () => {
    expect(dueSoonCount([], NOW)).toBe(0);
  });
});
