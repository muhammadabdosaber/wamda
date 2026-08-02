import { describe, expect, it } from "vitest";

import {
  directionOf,
  directionOfContent,
  enabledTags,
  primarySubtag,
  resolveLanguage,
  SUPPORTED,
} from "../src/core/language";

/**
 * These assertions mirror `supabase/functions/_shared/language.ts`. The rule is
 * implemented twice (client and server), so it is tested twice against the same
 * expectations -- if the two ever diverge, one of these suites fails.
 */
describe("primarySubtag", () => {
  it("reduces a region-qualified tag", () => {
    expect(primarySubtag("ar-AE")).toBe("ar");
    expect(primarySubtag("en_US")).toBe("en");
    expect(primarySubtag("  AR  ")).toBe("ar");
  });

  it("rejects anything that is not a language tag", () => {
    expect(primarySubtag(null)).toBeNull();
    expect(primarySubtag("")).toBeNull();
    expect(primarySubtag("123")).toBeNull();
    expect(primarySubtag("x")).toBeNull();
  });
});

describe("resolveLanguage precedence", () => {
  it("explicit beats profile beats navigator", () => {
    expect(
      resolveLanguage({ explicit: "ar", profile: "en", navigator: ["en"] }),
    ).toBe("ar");
  });

  it("falls back to the profile when nothing explicit is given", () => {
    expect(resolveLanguage({ profile: "ar", navigator: ["en"] })).toBe("ar");
  });

  it("falls back to navigator languages when there is no profile", () => {
    expect(resolveLanguage({ navigator: ["ar-AE", "en"] })).toBe("ar");
  });

  it("defaults to Arabic when nothing matches", () => {
    expect(resolveLanguage()).toBe("ar");
    expect(resolveLanguage({ explicit: "fr", navigator: ["de"] })).toBe("ar");
  });

  // The phase-1 contract: English is a KNOWN language that is not yet enabled.
  // Asking for it must degrade to Arabic, never throw and never return a
  // language with no catalogue behind it.
  it("a disabled language falls through instead of erroring", () => {
    expect(SUPPORTED.en?.enabled).toBe(false);
    expect(resolveLanguage({ explicit: "en" })).toBe("ar");
    expect(resolveLanguage({ navigator: ["en-US"] })).toBe("ar");
  });
});

describe("direction", () => {
  it("UI direction follows the resolved language", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
    expect(directionOf("zz")).toBe("rtl"); // default
  });

  it("content direction is independent of the UI locale", () => {
    // The phase-2 case this exists for: an English note body rendered inside
    // an Arabic UI must lay out LTR.
    expect(directionOfContent("en")).toBe("ltr");
    expect(directionOfContent("en-GB")).toBe("ltr");
    expect(directionOfContent("ar")).toBe("rtl");
    expect(directionOfContent(null)).toBe("rtl");
  });
});

it("exactly one language is enabled in phase 1", () => {
  expect(enabledTags()).toEqual(["ar"]);
});
