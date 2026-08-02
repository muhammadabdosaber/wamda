import { ar, arPlurals, type Messages, type PluralKey } from "./ar";
import { en, enPlurals } from "./en";

/**
 * Minimal i18n.
 *
 * No i18next: the only non-trivial requirement is correct Arabic plurals, and
 * `Intl.PluralRules` is built into every target browser and handles all six
 * CLDR categories. A framework here would add a dependency, a bundle, and an
 * async init step to solve a problem the platform already solves.
 */

const CATALOGUES: Record<string, Messages> = { ar, en };
const PLURALS: Record<string, Record<PluralKey, Record<string, string>>> = {
  ar: arPlurals as unknown as Record<PluralKey, Record<string, string>>,
  en: enPlurals,
};

export type MessageKey = keyof Messages;

export interface Translator {
  language: string;
  t: (key: MessageKey) => string;
  plural: (key: PluralKey, n: number) => string;
  /** Locale-aware number formatting -- Arabic-Indic digits where appropriate. */
  n: (value: number) => string;
  date: (value: string | Date) => string;
}

export function createTranslator(language: string): Translator {
  const messages = CATALOGUES[language] ?? ar;
  const plurals = PLURALS[language] ?? PLURALS.ar!;
  const rules = new Intl.PluralRules(language);
  const numbers = new Intl.NumberFormat(language);
  const dates = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return {
    language,
    t: (key) => messages[key],
    plural: (key, count) => {
      // Intl picks the CLDR category for this locale and count; the catalogue
      // supplies the phrasing for that category. Arabic 2 selects `two`,
      // 3-10 select `few`, 11-99 select `many` -- none of which a
      // singular/plural pair could express.
      const category = rules.select(count);
      const table = plurals[key] ?? {};
      const template = table[category] ?? table.other ?? "";
      return template.replace("{n}", numbers.format(count));
    },
    n: (value) => numbers.format(value),
    date: (value) => dates.format(typeof value === "string" ? new Date(value) : value),
  };
}

/**
 * Maps stored enum IDENTIFIERS to localized labels.
 *
 * The client half of the schema's load-bearing rule: the database stores
 * `'task'`, and the word "مهمة" exists only in `ar.ts`. Nothing persisted
 * anywhere is a display string, so adding English is a new catalogue rather
 * than a data migration, and rewording a label ships without a backfill.
 *
 * The `default` arms are not padding: the server can add an enum value before
 * a client that knows about it has shipped, and an old client must degrade to
 * "other" rather than render `undefined` inside a list.
 */
export function categoryLabel(t: Translator, identifier: string): string {
  switch (identifier) {
    case "task": return t.t("categoryTask");
    case "event": return t.t("categoryEvent");
    case "idea": return t.t("categoryIdea");
    case "learning": return t.t("categoryLearning");
    case "reference": return t.t("categoryReference");
    case "personal": return t.t("categoryPersonal");
    default: return t.t("categoryOther");
  }
}

export function priorityLabel(t: Translator, identifier: string): string {
  switch (identifier) {
    case "urgent": return t.t("priorityUrgent");
    case "high": return t.t("priorityHigh");
    case "low": return t.t("priorityLow");
    default: return t.t("priorityNormal");
  }
}

/**
 * Returns null for `none` so the caller renders no action chip at all. An
 * explicit "no action" chip is visual noise on most notes, and noise is the
 * specific thing this product exists to remove.
 */
export function actionLabel(t: Translator, identifier: string): string | null {
  switch (identifier) {
    case "create_task": return t.t("actionCreateTask");
    case "create_event": return t.t("actionCreateEvent");
    case "archive": return t.t("actionArchive");
    case "review_later": return t.t("actionReviewLater");
    default: return null;
  }
}

/**
 * API error CODES localized here. The server never sends prose -- a
 * server-generated Arabic sentence would be a second translation surface that
 * drifts away from these catalogues.
 */
export function errorLabel(t: Translator, code: string): string {
  switch (code) {
    case "unauthenticated": return t.t("errorUnauthenticated");
    case "transcription_failed": return t.t("errorTranscriptionFailed");
    case "enrichment_refused": return t.t("errorEnrichmentRefused");
    default: return t.t("errorGeneric");
  }
}
