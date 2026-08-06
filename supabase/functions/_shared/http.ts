/** CORS, JSON responses, and error shaping shared by every Edge Function. */

/**
 * Read at call time, not cached at module load -- lets tests toggle it with
 * `Deno.env.set`/`.delete` around each case (SB-010). No behaviour
 * difference in production: an Edge Function's env does not change during
 * its own lifetime.
 */
function allowedOrigin(): string | undefined {
  return Deno.env.get("ALLOWED_ORIGIN") || undefined;
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin() ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, accept-language",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/** Kept for callers that just need the header set for a normal response. */
export const CORS_HEADERS: Record<string, string> = corsHeaders();

/**
 * SB-010: `ALLOWED_ORIGIN` used to only decorate the CORS header -- every
 * preflight got a 204 regardless of who asked, leaving the actual gate to
 * whether the CALLING BROWSER honoured a mismatched
 * `Access-Control-Allow-Origin`. Real protection for a well-behaved browser,
 * but not a server-side gate. Now: when `ALLOWED_ORIGIN` is configured, a
 * preflight from any other `Origin` (including none) is rejected here,
 * before any CORS header naming the real origin is ever sent back.
 *
 * Unset (every local environment today) stays permissive -- matching the
 * existing `*` default and docs/09-status-handoff.md's own framing that `*`
 * is fine locally and wrong in production.
 */
export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;

  const allowed = allowedOrigin();
  if (allowed && req.headers.get("Origin") !== allowed) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Every response echoes the language it was served in. The client must never
 * have to infer which language it got back -- that inference is exactly where
 * a mixed-language UI comes from.
 */
export function json(
  body: unknown,
  init: { status?: number; language?: string; direction?: "rtl" | "ltr" } = {},
): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  };
  if (init.language) headers["Content-Language"] = init.language;

  const payload =
    init.language && typeof body === "object" && body !== null && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), language: init.language, direction: init.direction }
      : body;

  return new Response(JSON.stringify(payload), { status: init.status ?? 200, headers });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    /** Stable machine-readable code. The client maps this to a localized string. */
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/**
 * Error bodies carry a CODE, never a human sentence.
 *
 * A server-generated Arabic error message would be a second, invisible
 * translation surface that drifts from the app's ARB files. The client owns
 * all user-facing text; the server owns the code.
 */
export function errorResponse(err: unknown, language?: string): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code } }, { status: err.status, language });
  }
  // Never leak an internal message to the client -- stack traces and driver
  // errors routinely contain table names, IDs, and occasionally row data.
  console.error("unhandled_error", err instanceof Error ? err.message : String(err));
  return json({ error: { code: "internal_error" } }, { status: 500, language });
}

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new HttpError(500, "missing_configuration", `${name} is not set`);
  return v;
}
