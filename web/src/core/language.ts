/**
 * Client-side mirror of `supabase/functions/_shared/language.ts`.
 *
 * The client needs the same rules to render optimistically before the server
 * answers. Implementing one rule twice is a real divergence risk, so both
 * sides are tested against the same expectations (`test/language.test.ts`),
 * and this module is the only place the client decides a language.
 */

export type Direction = "rtl" | "ltr";

export interface LanguageConfig {
  tag: string;
  direction: Direction;
  enabled: boolean;
  /** Native name, shown in the language picker in its OWN script. */
  label: string;
}

/** Phase 2 = flip `en.enabled` to true. Nothing else in the app changes. */
export const SUPPORTED: Record<string, LanguageConfig> = {
  ar: { tag: "ar", direction: "rtl", enabled: true, label: "العربية" },
  en: { tag: "en", direction: "ltr", enabled: false, label: "English" },
};

export const DEFAULT_LANGUAGE = "ar";

export function enabledTags(): string[] {
  return Object.values(SUPPORTED)
    .filter((c) => c.enabled)
    .map((c) => c.tag);
}

/** `ar-AE` -> `ar`. Returns null for anything that is not a language tag. */
export function primarySubtag(input: string | null | undefined): string | null {
  if (!input) return null;
  const tag = input.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(tag) ? tag : null;
}

export interface ResolveInput {
  explicit?: string | null;
  profile?: string | null;
  /** `navigator.languages`, highest preference first. */
  navigator?: readonly string[];
}

/**
 * Resolution order: explicit -> profile -> navigator -> default ('ar').
 *
 * A requested-but-disabled language falls through rather than throwing: in
 * phase 1 a browser set to English must get an Arabic UI, not a crash and not
 * a blank screen full of missing keys.
 */
export function resolveLanguage(input: ResolveInput = {}): string {
  const candidates = [
    primarySubtag(input.explicit),
    primarySubtag(input.profile),
    ...(input.navigator ?? []).map(primarySubtag),
  ];

  for (const tag of candidates) {
    if (tag && SUPPORTED[tag]?.enabled) return tag;
  }
  return DEFAULT_LANGUAGE;
}

export function directionOf(tag: string): Direction {
  return SUPPORTED[tag]?.direction ?? "rtl";
}

/**
 * Direction for a NOTE BODY, independent of the UI language.
 *
 * This is why note text is not simply inherited from the page direction: in
 * phase 2 an English note inside an Arabic UI must lay out LTR, or its
 * trailing punctuation jumps to the wrong end of the sentence and embedded
 * Latin identifiers reorder. Users report that as corrupted data.
 */
export function directionOfContent(detected: string | null | undefined): Direction {
  return directionOf(primarySubtag(detected) ?? DEFAULT_LANGUAGE);
}

/**
 * Apply the UI language to the document.
 *
 * Both attributes matter, and they do different jobs:
 *   `dir`  drives the CSS logical properties the whole stylesheet is built on
 *   `lang` drives font selection, hyphenation, and screen-reader pronunciation
 *
 * Setting only `dir` gives a correctly mirrored layout that a screen reader
 * reads out in the wrong language.
 */
export function applyDirection(tag: string): void {
  const el = document.documentElement;
  el.lang = tag;
  el.dir = directionOf(tag);
}
