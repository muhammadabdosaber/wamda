import { describe, expect, it } from "vitest";

import { ar } from "../src/i18n/ar";
import { en } from "../src/i18n/en";
import {
  actionLabel,
  categoryLabel,
  createTranslator,
  errorLabel,
  priorityLabel,
} from "../src/i18n";

describe("catalogues", () => {
  // Arabic is the template. If a key is added there and forgotten in English
  // this fails -- and TypeScript already refuses to compile `en.ts`, so this
  // is the runtime backstop for the same rule.
  it("English covers every Arabic key", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });

  it("no catalogue value is empty", () => {
    for (const [key, value] of Object.entries(ar)) {
      expect(value, `ar.${key}`).not.toBe("");
    }
  });
});

/**
 * The reason this app does its own plural handling rather than a naive
 * `n === 1 ? a : b`.
 *
 * Arabic uses six CLDR categories. A singular/plural pair produces
 * grammatically wrong output for 2 (dual), for 3-10 (few), and for 11-99
 * (many) -- which between them cover essentially every count a user sees.
 */
describe("Arabic plurals", () => {
  const t = createTranslator("ar");

  it("selects the dual form for 2", () => {
    expect(new Intl.PluralRules("ar").select(2)).toBe("two");
    expect(t.plural("pendingSync", 2)).toBe("ملاحظتان بانتظار المزامنة");
  });

  it("selects distinct forms for 1, 2, 3 and 11", () => {
    const forms = [1, 2, 3, 11].map((n) => t.plural("pendingSync", n));
    // one / two / few / many must all be different strings.
    expect(new Set(forms).size).toBe(4);
  });

  it("interpolates a locale-formatted count", () => {
    const three = t.plural("pendingSync", 3);
    expect(three).toContain(new Intl.NumberFormat("ar").format(3));
    expect(three).not.toContain("{n}");
  });

  it("returns empty for zero so the UI renders nothing", () => {
    expect(t.plural("pendingSync", 0)).toBe("");
  });

  // The Tasks screen shows an open-count beside each group heading; Arabic
  // needs the dual (2), few (3-10) and many (11+) forms to read correctly.
  it("counts tasks with the right form for 1, 2, 3 and 11", () => {
    expect(t.plural("taskCount", 1)).toBe("مهمة واحدة");
    expect(t.plural("taskCount", 2)).toBe("مهمتان");
    const forms = [1, 2, 3, 11].map((n) => t.plural("taskCount", n));
    expect(new Set(forms).size).toBe(4);
  });
});

describe("English plurals", () => {
  const t = createTranslator("en");

  it("uses one/other only", () => {
    expect(t.plural("pendingSync", 1)).toBe("1 note waiting to sync");
    expect(t.plural("pendingSync", 5)).toBe("5 notes waiting to sync");
  });
});

/**
 * The client half of "never store a display label as a key": the database
 * holds `'task'`, and the Arabic word exists only in the catalogue.
 */
describe("enum identifier -> label", () => {
  const t = createTranslator("ar");

  it("maps stored identifiers to Arabic labels", () => {
    expect(categoryLabel(t, "task")).toBe("مهمة");
    expect(priorityLabel(t, "urgent")).toBe("عاجل");
    expect(actionLabel(t, "create_task")).toBe("أضفها كمهمة");
  });

  // The server can add an enum value before a client that knows about it has
  // shipped. An old client must degrade, not render `undefined`.
  it("degrades gracefully on an unknown identifier", () => {
    expect(categoryLabel(t, "quantum_todo")).toBe(ar.categoryOther);
    expect(priorityLabel(t, "whenever")).toBe(ar.priorityNormal);
  });

  it("returns null for the 'none' action so no chip renders", () => {
    expect(actionLabel(t, "none")).toBeNull();
  });

  it("localizes API error codes", () => {
    expect(errorLabel(t, "unauthenticated")).toBe(ar.errorUnauthenticated);
    expect(errorLabel(t, "some_future_code")).toBe(ar.errorGeneric);
  });
});
