/**
 * Vendor adapters behind narrow interfaces.
 *
 * Every provider is reached through an interface with a `language` parameter.
 * That is what makes the ASR and embedding vendors swappable, and it is also
 * what makes phase 2 a config change: nothing here hardcodes Arabic.
 *
 * API keys are read from Edge Function secrets and never leave the server.
 */

import { HttpError, requireEnv } from "./http.ts";
import { SUPPORTED } from "./language.ts";

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

export interface TranscriptionResult {
  text: string;
  /** 0-1. Low values flag the note for review instead of silently enriching noise. */
  confidence: number;
  detectedLanguage: string | null;
  provider: string;
  model: string;
}

export interface ASRProvider {
  readonly name: string;
  transcribe(audio: Blob, language: string): Promise<TranscriptionResult>;
}

/**
 * ElevenLabs Scribe.
 *
 * Chosen for Arabic word-error rate including dialectal speech. `language_code`
 * is a parameter, not a baked-in constant, so enabling English is a registry
 * change in language.ts rather than an edit here.
 */
export class ScribeASR implements ASRProvider {
  readonly name = "elevenlabs";
  private readonly model = "scribe_v1";

  async transcribe(audio: Blob, language: string): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append("file", audio, "note.m4a");
    form.append("model_id", this.model);
    form.append("language_code", SUPPORTED[language]?.asrCode ?? "ara");
    // Word timestamps let the client scrub audio against the transcript later.
    form.append("timestamps_granularity", "word");
    form.append("diarize", "false");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": requireEnv("ELEVENLABS_API_KEY") },
      body: form,
    });

    if (!res.ok) {
      console.error("asr_failed", res.status, await res.text().catch(() => ""));
      throw new HttpError(502, "transcription_failed");
    }

    const data = await res.json();

    // Scribe reports per-word probabilities; the note-level confidence is
    // their mean. A single garbled word in a long note should not condemn it,
    // but a uniformly low-probability transcript should be flagged.
    const words: Array<{ logprob?: number; probability?: number }> = data.words ?? [];
    const probs = words
      .map((w) => w.probability ?? (typeof w.logprob === "number" ? Math.exp(w.logprob) : null))
      .filter((p): p is number => typeof p === "number");
    const confidence = probs.length
      ? probs.reduce((a, b) => a + b, 0) / probs.length
      : 1;

    return {
      text: (data.text ?? "").trim(),
      confidence,
      detectedLanguage: data.language_code ?? null,
      provider: this.name,
      model: this.model,
    };
  }
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

/**
 * Cohere embed-multilingual-v3.0 (1024-dim).
 *
 * The reason this specific model matters: it aligns Arabic and English into a
 * SHARED vector space. In phase 2 an Arabic query will retrieve English notes
 * with no re-indexing and no translation step. A monolingual Arabic embedder
 * would force a full re-embed of the entire corpus the day English ships.
 *
 * document vs query input types are not interchangeable -- Cohere embeds them
 * asymmetrically, and using `search_document` for queries measurably degrades
 * retrieval.
 */
export class CohereEmbeddings implements EmbeddingProvider {
  readonly name = "cohere";
  readonly model = "embed-multilingual-v3.0";
  readonly dimensions = 1024;

  async embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
    if (texts.length === 0) return [];

    const res = await fetch("https://api.cohere.com/v1/embed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("COHERE_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        texts,
        input_type: kind === "document" ? "search_document" : "search_query",
        embedding_types: ["float"],
        truncate: "END",
      }),
    });

    if (!res.ok) {
      console.error("embed_failed", res.status, await res.text().catch(() => ""));
      throw new HttpError(502, "embedding_failed");
    }

    const data = await res.json();
    const vectors: number[][] = data.embeddings?.float ?? data.embeddings ?? [];
    if (vectors.length !== texts.length) {
      throw new HttpError(502, "embedding_count_mismatch");
    }
    return vectors;
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
// Single construction point per capability. Swapping vendors is one line, and
// there is no call site anywhere else that knows a vendor name.

export function asrProvider(): ASRProvider {
  return new ScribeASR();
}

export function embeddingProvider(): EmbeddingProvider {
  return new CohereEmbeddings();
}
