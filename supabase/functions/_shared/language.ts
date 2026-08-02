/**
 * Language resolution + detection.
 *
 * This module is the single seam that makes the system multilingual-ready.
 * Every downstream stage (transcription, enrichment, embedding, storage,
 * retrieval) receives an explicit BCP-47 tag and never infers language on its
 * own. Adding English in phase 2 means registering it in SUPPORTED below --
 * no pipeline stage changes.
 */

export type LanguageTag = string;

export interface LanguageConfig {
  /** BCP-47 primary subtag. */
  tag: LanguageTag;
  /** Writing direction, handed to the client so it never has to guess. */
  direction: "rtl" | "ltr";
  /** Language code passed to the ASR provider. */
  asrCode: string;
  /** Unicode ranges that count as evidence of this script. */
  scriptRanges: Array<[number, number]>;
  /** Enabled for user-facing input. Phase 2 flips `en` to true. */
  enabled: boolean;
}

/**
 * THE language registry. Phase 2 = set `en.enabled = true`.
 *
 * `en` is defined but disabled from day one on purpose: it keeps the detection
 * code, the direction plumbing, and the per-language storage paths exercised
 * in phase 1 rather than dormant. Code that has never run once is code that
 * does not work.
 */
export const SUPPORTED: Record<string, LanguageConfig> = {
  ar: {
    tag: "ar",
    direction: "rtl",
    asrCode: "ara",
    // Arabic, Arabic Supplement, Extended-A, Presentation Forms A/B.
    scriptRanges: [
      [0x0600, 0x06ff],
      [0x0750, 0x077f],
      [0x08a0, 0x08ff],
      [0xfb50, 0xfdff],
      [0xfe70, 0xfeff],
    ],
    enabled: true,
  },
  en: {
    tag: "en",
    direction: "ltr",
    asrCode: "eng",
    scriptRanges: [
      [0x0041, 0x005a],
      [0x0061, 0x007a],
    ],
    enabled: false,
  },
};

export const DEFAULT_LANGUAGE: LanguageTag = "ar";

/** Reduce `ar-AE` to `ar`; unknown or malformed input yields null. */
export function primarySubtag(input: string | null | undefined): string | null {
  if (!input) return null;
  const tag = input.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(tag) ? tag : null;
}

/** Parse an Accept-Language header, highest q-value first. */
export function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      return { tag: primarySubtag(tag), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((x): x is { tag: string; q: number } => x.tag !== null && !Number.isNaN(x.q))
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}

export interface ResolveInput {
  /** Explicit `lang` from query string or body. Highest precedence. */
  explicit?: string | null;
  /** The user's stored ui_locale. */
  profile?: string | null;
  /** Raw Accept-Language header. */
  acceptLanguage?: string | null;
}

export interface Resolved {
  language: LanguageTag;
  direction: "rtl" | "ltr";
  /** Which input won, for debugging a "why is this English?" report. */
  source: "explicit" | "profile" | "header" | "default";
}

/**
 * Resolution order: explicit -> profile -> Accept-Language -> default ('ar').
 *
 * Resolved exactly once, at the edge. Re-resolving per stage is how a pipeline
 * ends up transcribing in one language and summarizing in another.
 *
 * A requested-but-disabled language falls through rather than erroring: in
 * phase 1 a browser sending `Accept-Language: en` should get an Arabic
 * response, not a 400.
 */
export function resolveLanguage(input: ResolveInput): Resolved {
  const candidates: Array<[string | null, Resolved["source"]]> = [
    [primarySubtag(input.explicit), "explicit"],
    [primarySubtag(input.profile), "profile"],
    ...parseAcceptLanguage(input.acceptLanguage ?? null).map(
      (t) => [t, "header"] as [string, Resolved["source"]],
    ),
  ];

  for (const [tag, source] of candidates) {
    if (tag && SUPPORTED[tag]?.enabled) {
      return { language: tag, direction: SUPPORTED[tag].direction, source };
    }
  }

  return {
    language: DEFAULT_LANGUAGE,
    direction: SUPPORTED[DEFAULT_LANGUAGE].direction,
    source: "default",
  };
}

export interface Detection {
  language: LanguageTag;
  confidence: number;
}

/**
 * Script-ratio language detection.
 *
 * Cheap, synchronous, no model call, no network. It cannot separate two
 * languages that share a script (Arabic vs Persian, English vs German), which
 * is fine for the ar/en split this product actually needs -- and when it is
 * not, the low confidence score is the signal to escalate to a model.
 *
 * This runs on every note in phase 1 even though nothing routes on it yet.
 * It populates `detected_language`, so the day English is enabled there is
 * already a corpus to validate the routing against.
 */
export function detectLanguage(text: string | null | undefined): Detection | null {
  if (!text) return null;
  const stripped = text.replace(/[\s\d\p{P}\p{S}]/gu, "");
  const total = [...stripped].length;
  if (total < 4) return null; // too short to be evidence of anything

  const counts = new Map<string, number>();
  for (const ch of stripped) {
    const cp = ch.codePointAt(0)!;
    for (const [tag, cfg] of Object.entries(SUPPORTED)) {
      if (cfg.scriptRanges.some(([lo, hi]) => cp >= lo && cp <= hi)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
        break;
      }
    }
  }

  let best: Detection | null = null;
  for (const [tag, n] of counts) {
    const confidence = n / total;
    if (!best || confidence > best.confidence) best = { language: tag, confidence };
  }

  // Mixed-script text (Arabic notes routinely embed English product names)
  // legitimately scores below 1.0. The threshold only rejects text with no
  // clear majority script at all.
  return best && best.confidence >= 0.5 ? best : best;
}
