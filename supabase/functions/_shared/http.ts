/** CORS, JSON responses, and error shaping shared by every Edge Function. */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept-language",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS"
    ? new Response(null, { status: 204, headers: CORS_HEADERS })
    : null;
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
